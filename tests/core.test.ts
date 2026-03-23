import { describe, expect, test } from "bun:test";
import { HeartbeatSchema, SessionConfigSchema, StepOutputSchema } from "@afk/core";

const VALID_HEARTBEAT = {
  timestamp: "2026-03-15T03:42:00Z",
  pid: 48291,
  agent: "claude",
  step: "implement" as const,
  phase: "main" as const,
  task_id: "auth-flow",
  subtask: null,
  iteration: 3,
  review_round: 2,
  tests: { passing: 47, failing: 2, coverage_pct: 82 },
  tokens_used: 124500,
  restarts: 0,
  quota: { status: "ok" as const, hits: 0, total_wait_seconds: 0, last_hit_at: null },
};

describe("HeartbeatSchema", () => {
  test("validates a valid heartbeat", () => {
    expect(HeartbeatSchema.safeParse(VALID_HEARTBEAT).success).toBe(true);
  });
  test("rejects missing required fields", () => {
    expect(HeartbeatSchema.safeParse({ pid: 123 }).success).toBe(false);
  });
  test("rejects invalid step name", () => {
    expect(HeartbeatSchema.safeParse({ ...VALID_HEARTBEAT, step: "unknown" }).success).toBe(false);
  });
});

describe("StepOutputSchema", () => {
  test("validates a valid step output", () => {
    const result = StepOutputSchema.safeParse({
      step: "implement",
      task_id: "auth-flow",
      status: "completed",
      summary: "implemented OAuth flow",
      decisions: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("SessionConfigSchema", () => {
  test("applies defaults for missing optional sections", () => {
    const result = SessionConfigSchema.safeParse({
      session: { name: "test", tracks: 2, autonomy: "full", started_at: null, status: "idle" },
    });
    expect(result.success).toBe(true);
    expect(result.data?.heartbeat.interval_seconds).toBe(30);
    expect(result.data?.loop.review_rounds_min).toBe(2);
    expect(result.data?.workflow.max_task_iterations).toBe(15);
  });
  test("rejects tracks > 20", () => {
    const result = SessionConfigSchema.safeParse({
      session: { name: "test", tracks: 25, autonomy: "full", started_at: null, status: "idle" },
    });
    expect(result.success).toBe(false);
  });
});
