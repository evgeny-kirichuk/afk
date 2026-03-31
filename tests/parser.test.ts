import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision,
  readHeartbeat,
  readSpec,
  readStepOutput,
  readTasks,
  writeHeartbeat,
  writeStepInput,
  writeTasks,
} from "@afk/core";
import type { DecisionEntry, HeartbeatData, StepInput, StepOutput, TaskEntry } from "@afk/core";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = "2026-01-01T00:00:00.000Z";

const HEARTBEAT: HeartbeatData = {
  timestamp: NOW,
  pid: 12345,
  agent: "claude",
  step: "implement",
  phase: "main",
  task_id: "task-001",
  subtask: null,
  iteration: 1,
  review_round: 0,
  tests: null,
  tokens_used: 500,
  restarts: 0,
  quota: { status: "ok", hits: 0, total_wait_seconds: 0, last_hit_at: null },
};

const STEP_OUTPUT: StepOutput = {
  step: "implement",
  task_id: "task-001",
  status: "completed",
  summary: "Feature implemented",
  decisions: [],
};

const STEP_INPUT: StepInput = {
  step: "implement",
  task_id: "task-001",
  track_id: "track-001",
  session_id: "session-001",
  spec_path: "afk/context/specs/task-001.md",
  review_context: null,
  memory_snippets: [],
  iteration: 1,
  model: "claude-sonnet-4-6",
  tier: "frontier",
};

const TASK: TaskEntry = {
  id: "my-task",
  title: "My Task",
  status: "queued",
  track: null,
  spec_path: null,
  source: "cli",
  depends_on: [],
  created_at: NOW,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

let afkDir: string;
let trackDir: string;

beforeEach(async () => {
  afkDir = await mkdtemp(join(tmpdir(), "afk-parser-test-"));
  trackDir = join(afkDir, "tracks", "track-001");
  await mkdir(trackDir, { recursive: true });
});

afterEach(async () => {
  await rm(afkDir, { recursive: true, force: true });
});

// ── readTasks / writeTasks ────────────────────────────────────────────────────

describe("readTasks", () => {
  test("returns empty array when tasks.md does not exist", async () => {
    expect(await readTasks(afkDir)).toEqual([]);
  });

  test("returns empty array for tasks.md with no task lines", async () => {
    await Bun.write(join(afkDir, "tasks.md"), "# Tasks\n\nsome other content\n");
    expect(await readTasks(afkDir)).toEqual([]);
  });
});

describe("writeTasks / readTasks roundtrip", () => {
  test("queued task survives write → read roundtrip", async () => {
    await writeTasks(afkDir, [TASK]);
    const tasks = await readTasks(afkDir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "my-task", title: "My Task", status: "queued" });
  });

  test("checkbox maps to correct status: [ ] queued, [x] completed, [?] needs_input", async () => {
    // id is re-derived from title on read (title.replace(/\s+/g, "-").toLowerCase())
    const tasks: TaskEntry[] = [
      { ...TASK, id: "queued", title: "Queued", status: "queued" },
      { ...TASK, id: "done", title: "Done", status: "completed" },
      { ...TASK, id: "needs-input", title: "Needs Input", status: "needs_input" },
    ];
    await writeTasks(afkDir, tasks);
    const read = await readTasks(afkDir);
    expect(read.find((t) => t.id === "queued")?.status).toBe("queued");
    expect(read.find((t) => t.id === "done")?.status).toBe("completed");
    expect(read.find((t) => t.id === "needs-input")?.status).toBe("needs_input");
  });

  test("in_progress status is preserved via explicit metadata", async () => {
    await writeTasks(afkDir, [{ ...TASK, id: "wip", title: "WIP", status: "in_progress" }]);
    const read = await readTasks(afkDir);
    expect(read[0]?.status).toBe("in_progress");
  });

  test("track, spec_path, and depends_on survive roundtrip", async () => {
    const task: TaskEntry = {
      ...TASK,
      id: "task-a",
      title: "Task A",
      track: "core",
      spec_path: "afk/context/specs/task-a.md",
      depends_on: ["task-b", "task-c"],
    };
    await writeTasks(afkDir, [task]);
    const read = await readTasks(afkDir);
    expect(read[0]?.track).toBe("core");
    expect(read[0]?.spec_path).toBe("afk/context/specs/task-a.md");
    expect(read[0]?.depends_on).toEqual(["task-b", "task-c"]);
  });
});

// ── readSpec ──────────────────────────────────────────────────────────────────

describe("readSpec", () => {
  test("returns spec file content", async () => {
    const specDir = join(afkDir, "context", "specs");
    await mkdir(specDir, { recursive: true });
    await Bun.write(join(specDir, "task-001.md"), "# Spec\nDo the thing.");

    const content = await readSpec(afkDir, "task-001");
    expect(content).toBe("# Spec\nDo the thing.");
  });

  test("throws for missing spec file", async () => {
    const specDir = join(afkDir, "context", "specs");
    await mkdir(specDir, { recursive: true });
    await Promise.resolve(expect(readSpec(afkDir, "nonexistent")).rejects.toThrow());
  });
});

// ── appendDecision ────────────────────────────────────────────────────────────

describe("appendDecision", () => {
  test("creates decisions.jsonl on first call", async () => {
    const entry: DecisionEntry = { ts: NOW, type: "decision", task: "task-001" };
    await appendDecision(trackDir, entry);

    expect(await Bun.file(join(trackDir, "decisions.jsonl")).exists()).toBe(true);
  });

  test("each appended entry is valid JSON on its own line", async () => {
    await appendDecision(trackDir, { ts: NOW, type: "decision", task: "task-001" });
    await appendDecision(trackDir, { ts: NOW, type: "task_done", task: "task-001" });

    const lines = (await Bun.file(join(trackDir, "decisions.jsonl")).text())
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    expect(() => JSON.parse(lines[1]!)).not.toThrow();
    expect(JSON.parse(lines[1]!).type).toBe("task_done");
  });

  test("extra fields are preserved via passthrough schema", async () => {
    const entry = { ts: NOW, type: "decision", task: "task-001", extra: "value" } as DecisionEntry;
    await appendDecision(trackDir, entry);

    const line = (await Bun.file(join(trackDir, "decisions.jsonl")).text()).trim();
    expect(JSON.parse(line).extra).toBe("value");
  });
});

// ── readHeartbeat / writeHeartbeat ────────────────────────────────────────────

describe("readHeartbeat / writeHeartbeat roundtrip", () => {
  test("write → read preserves all fields", async () => {
    await writeHeartbeat(trackDir, HEARTBEAT);
    const read = await readHeartbeat(trackDir);
    expect(read).toEqual(HEARTBEAT);
  });

  test("readHeartbeat throws on invalid data", async () => {
    await Bun.write(join(trackDir, "heartbeat.json"), JSON.stringify({ invalid: true }));
    await Promise.resolve(expect(readHeartbeat(trackDir)).rejects.toThrow());
  });
});

// ── writeStepInput / readStepOutput ──────────────────────────────────────────

describe("writeStepInput", () => {
  test("writes valid JSON to step-input.json", async () => {
    await writeStepInput(trackDir, STEP_INPUT);
    const raw = await Bun.file(join(trackDir, "step-input.json")).json();
    expect(raw).toMatchObject({ step: "implement", task_id: "task-001", track_id: "track-001" });
  });
});

describe("readStepOutput", () => {
  test("reads and validates step_complete.json", async () => {
    await Bun.write(join(trackDir, "step_complete.json"), JSON.stringify(STEP_OUTPUT));
    const output = await readStepOutput(trackDir);
    expect(output).toMatchObject({ step: "implement", task_id: "task-001", status: "completed" });
  });

  test("throws for invalid step_complete.json content", async () => {
    await Bun.write(join(trackDir, "step_complete.json"), JSON.stringify({ invalid: true }));
    await Promise.resolve(expect(readStepOutput(trackDir)).rejects.toThrow());
  });
});
