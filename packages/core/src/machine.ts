import { createActor, setup, type SnapshotFrom } from "xstate";

// ── Events ────────────────────────────────────────────────────────────────────

export type TaskEvent =
  | { type: "NEXT" }
  | { type: "FAIL" }
  | { type: "NEEDS_CHANGES" }
  | { type: "PASS" };

// ── Machine ───────────────────────────────────────────────────────────────────

/**
 * Minimal task-level state machine for the P0.1b spike.
 *
 * Top-level flow:
 *   idle → prep → implement → validate → commit → done
 *                    ↑            │
 *                    └── review ──┘  (on NEEDS_CHANGES)
 *
 * `validate` is a compound state with a `running` sub-state to verify that
 * XState v5 hierarchical machines work. Transitions out of `validate` are
 * triggered by events sent while in the `running` sub-state.
 */
export const taskMachine = setup({
  types: {
    events: {} as TaskEvent,
  },
}).createMachine({
  id: "task",
  initial: "idle",
  states: {
    idle: {
      on: { NEXT: "prep" },
    },
    prep: {
      on: {
        NEXT: "implement",
        FAIL: "failed",
      },
    },
    implement: {
      on: {
        NEXT: "validate",
        FAIL: "failed",
      },
    },
    validate: {
      initial: "running",
      states: {
        running: {
          on: {
            // Transitions use root-level state IDs
            PASS: "#task.commit",
            FAIL: "#task.implement",
            NEEDS_CHANGES: "#task.review",
          },
        },
      },
    },
    review: {
      on: {
        NEXT: "implement",
        FAIL: "failed",
      },
    },
    commit: {
      on: {
        NEXT: "done",
        FAIL: "failed",
      },
    },
    done: {
      type: "final",
    },
    failed: {
      type: "final",
    },
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskMachineSnapshot = SnapshotFrom<typeof taskMachine>;

// ── Actor helpers ─────────────────────────────────────────────────────────────

/** Create a new actor, optionally restoring from a persisted snapshot. */
export function createTaskActor(snapshot?: TaskMachineSnapshot) {
  return createActor(taskMachine, snapshot ? { snapshot } : undefined);
}

/** Serialize a snapshot to a plain JSON string for SQLite storage. */
export function serializeSnapshot(snapshot: TaskMachineSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Deserialize a snapshot from SQLite storage. */
export function deserializeSnapshot(raw: string): TaskMachineSnapshot {
  return JSON.parse(raw) as TaskMachineSnapshot;
}
