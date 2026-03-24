import { describe, expect, test } from "bun:test";
import { DecisionEntrySchema, HeartbeatSchema, SessionConfigSchema, StepOutputSchema } from "@afk/core";

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

describe("Zod 4 compatibility", () => {
  test(".passthrough() preserves extra keys on SessionConfigSchema", () => {
    const result = SessionConfigSchema.safeParse({
      session: { name: "test", tracks: 1, autonomy: "full", started_at: null, status: "idle" },
      git: { local_changes: "stash", branch_prefix: "afk/" },
      autonomy_modes: { full: { auto_approve: true } },
    });
    expect(result.success).toBe(true);
    expect((result.data as any).git).toEqual({ local_changes: "stash", branch_prefix: "afk/" });
    expect((result.data as any).autonomy_modes).toEqual({ full: { auto_approve: true } });
  });

  test(".safeParse() error shape has .format() and .issues", () => {
    const result = SessionConfigSchema.safeParse({ session: { name: 123 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error.format).toBe("function");
      expect(Array.isArray(result.error.issues)).toBe(true);
    }
  });

  test(".safeParse() success shape has .success and .data", () => {
    const result = SessionConfigSchema.safeParse({
      session: { name: "test", tracks: 1, autonomy: "full", started_at: null, status: "idle" },
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  test("DecisionEntrySchema.passthrough() preserves extra fields", () => {
    const result = DecisionEntrySchema.safeParse({
      ts: "2026-03-15T03:42:00Z",
      type: "approval",
      task: "auth-flow",
      custom_field: "extra-data",
      priority: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).custom_field).toBe("extra-data");
      expect((result.data as any).priority).toBe(5);
    }
  });
});
