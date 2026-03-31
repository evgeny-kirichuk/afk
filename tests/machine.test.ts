import { describe, expect, test } from "bun:test";
import {
  createTaskActor,
  deserializeSnapshot,
  serializeSnapshot,
  type TaskMachineSnapshot,
} from "../packages/core/src/machine.ts";
import { SessionStore } from "../packages/core/src/session-store.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateValue(actor: ReturnType<typeof createTaskActor>): unknown {
  return actor.getSnapshot().value;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("taskMachine — state transitions", () => {
  test("advances through happy path: idle → prep → implement → validate → commit → done", () => {
    const actor = createTaskActor();
    actor.start();

    expect(stateValue(actor)).toBe("idle");

    actor.send({ type: "NEXT" });
    expect(stateValue(actor)).toBe("prep");

    actor.send({ type: "NEXT" });
    expect(stateValue(actor)).toBe("implement");

    actor.send({ type: "NEXT" });
    // validate is a compound state — value is an object
    expect(stateValue(actor)).toEqual({ validate: "running" });

    actor.send({ type: "PASS" });
    expect(stateValue(actor)).toBe("commit");

    actor.send({ type: "NEXT" });
    expect(stateValue(actor)).toBe("done");
  });

  test("FAIL from prep/implement/review/commit lands on failed", () => {
    for (const step of ["prep", "implement", "review", "commit"] as const) {
      const actor = createTaskActor();
      actor.start();

      // Advance to the target step
      const steps: Array<{ type: "NEXT" | "FAIL" | "NEEDS_CHANGES" | "PASS" }> = [];
      if (step === "prep") steps.push({ type: "NEXT" });
      if (step === "implement") steps.push({ type: "NEXT" }, { type: "NEXT" });
      if (step === "review") {
        steps.push({ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }); // idle→prep→implement→validate
        // validate → review requires NEEDS_CHANGES
        steps.push({ type: "NEEDS_CHANGES" });
      }
      if (step === "commit") {
        steps.push({ type: "NEXT" }, { type: "NEXT" }, { type: "NEXT" }, { type: "PASS" });
      }

      for (const e of steps) actor.send(e);
      actor.send({ type: "FAIL" });
      expect(stateValue(actor)).toBe("failed");
    }
  });
});

describe("taskMachine — nested validate states", () => {
  test("validate starts in running sub-state", () => {
    const actor = createTaskActor();
    actor.start();
    actor.send({ type: "NEXT" }); // → prep
    actor.send({ type: "NEXT" }); // → implement
    actor.send({ type: "NEXT" }); // → validate

    expect(stateValue(actor)).toEqual({ validate: "running" });
  });

  test("NEEDS_CHANGES from validate.running transitions to review back-edge", () => {
    const actor = createTaskActor();
    actor.start();
    actor.send({ type: "NEXT" }); // → prep
    actor.send({ type: "NEXT" }); // → implement
    actor.send({ type: "NEXT" }); // → validate.running
    actor.send({ type: "NEEDS_CHANGES" }); // → review
    expect(stateValue(actor)).toBe("review");

    actor.send({ type: "NEXT" }); // review → implement (back-edge)
    expect(stateValue(actor)).toBe("implement");
  });

  test("FAIL from validate.running retries implement", () => {
    const actor = createTaskActor();
    actor.start();
    actor.send({ type: "NEXT" }); // → prep
    actor.send({ type: "NEXT" }); // → implement
    actor.send({ type: "NEXT" }); // → validate.running
    actor.send({ type: "FAIL" }); // → implement (retry)
    expect(stateValue(actor)).toBe("implement");
  });
});

describe("taskMachine — SQLite checkpoint/resume", () => {
  test("restores machine state after simulated kill -9", () => {
    const dbPath = ":memory:";
    const store = new SessionStore(dbPath);

    // ── Before "crash" ──────────────────────────────────────────────
    const actor = createTaskActor();
    actor.start();

    actor.send({ type: "NEXT" }); // → prep
    actor.send({ type: "NEXT" }); // → implement

    expect(stateValue(actor)).toBe("implement");

    // Supervisor saves snapshot after each transition
    store.saveSnapshot("machine-task-1", actor.getSnapshot());

    // ── Simulate kill -9: actor is gone ─────────────────────────────
    actor.stop();

    // ── Supervisor restarts, restores from DB ────────────────────────
    const raw = store.restoreSnapshot("machine-task-1");
    expect(raw).not.toBeNull();

    const restoredActor = createTaskActor(raw as TaskMachineSnapshot);
    restoredActor.start();

    // State must match what was saved
    expect(stateValue(restoredActor)).toBe("implement");

    // Execution can continue from restored state
    restoredActor.send({ type: "NEXT" }); // → validate
    expect(stateValue(restoredActor)).toEqual({ validate: "running" });

    store.close();
  });

  test("saveSnapshot is idempotent — multiple saves overwrite correctly", () => {
    const store = new SessionStore(":memory:");

    const actor = createTaskActor();
    actor.start();
    actor.send({ type: "NEXT" }); // → prep
    store.saveSnapshot("machine-x", actor.getSnapshot());

    actor.send({ type: "NEXT" }); // → implement
    store.saveSnapshot("machine-x", actor.getSnapshot()); // overwrite

    const raw = store.restoreSnapshot("machine-x");
    const restored = createTaskActor(raw as TaskMachineSnapshot);
    restored.start();

    expect(stateValue(restored)).toBe("implement");
    store.close();
  });

  test("restoreSnapshot returns null for unknown machine IDs", () => {
    const store = new SessionStore(":memory:");
    expect(store.restoreSnapshot("nonexistent")).toBeNull();
    store.close();
  });
});

describe("taskMachine — serialization helpers", () => {
  test("serializeSnapshot / deserializeSnapshot roundtrip preserves state", () => {
    const actor = createTaskActor();
    actor.start();
    actor.send({ type: "NEXT" }); // → prep

    const serialized = serializeSnapshot(actor.getSnapshot());
    expect(typeof serialized).toBe("string");

    const deserialized = deserializeSnapshot(serialized);
    const restored = createTaskActor(deserialized);
    restored.start();

    expect(restored.getSnapshot().value).toBe("prep");
  });

  test("serialized snapshot is valid JSON", () => {
    const actor = createTaskActor();
    actor.start();
    actor.send({ type: "NEXT" }); // → prep
    actor.send({ type: "NEXT" }); // → implement

    const serialized = serializeSnapshot(actor.getSnapshot());
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});
