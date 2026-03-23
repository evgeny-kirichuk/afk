import { z } from "zod";

const STEP_NAMES = [
  "prep",
  "pick",
  "analyze",
  "test_plan",
  "implement",
  "cleanup",
  "simplify",
  "review",
  "distill",
  "validate",
  "commit",
  "explore",
] as const;

export const HeartbeatSchema = z.object({
  timestamp: z.string().datetime(),
  pid: z.number().int().positive(),
  agent: z.string(),
  step: z.enum(STEP_NAMES),
  phase: z.enum(["main", "exploration"]),
  task_id: z.string(),
  subtask: z.string().nullable(),
  iteration: z.number().int().min(0),
  review_round: z.number().int().min(0),
  tests: z
    .object({
      passing: z.number().int().min(0),
      failing: z.number().int().min(0),
      coverage_pct: z.number().min(0).max(100),
    })
    .nullable(),
  tokens_used: z.number().int().min(0),
  restarts: z.number().int().min(0),
  quota: z.object({
    status: z.enum(["ok", "hit", "recovering"]),
    hits: z.number().int().min(0),
    total_wait_seconds: z.number().min(0),
    last_hit_at: z.string().datetime().nullable(),
  }),
});

export const StepOutputSchema = z.object({
  step: z.enum(STEP_NAMES),
  task_id: z.string(),
  status: z.enum(["completed", "needs_input", "failed"]),
  summary: z.string(),
  decisions: z.array(
    z.object({ ts: z.string().datetime(), type: z.string(), task: z.string() }).passthrough(),
  ),
  error: z.string().optional(),
});

export const DecisionEntrySchema = z
  .object({
    ts: z.string().datetime(),
    type: z.string(),
    task: z.string(),
  })
  .passthrough();

const HeartbeatConfigSchema = z.object({
  interval_seconds: z.number().positive().default(30),
  stall_threshold_seconds: z.number().positive().default(300),
  max_restarts_per_track: z.number().int().min(0).default(3),
});

const LoopConfigSchema = z.object({
  review_rounds_min: z.number().int().min(1).default(2),
  review_rounds_max: z.number().int().min(1).default(5),
  test_coverage_required: z.boolean().default(true),
  exploration_mode: z.boolean().default(true),
  exploration_budget: z.number().int().positive().default(100_000),
});

const WorkflowConfigSchema = z.object({
  steps: z
    .record(
      z.string(),
      z.object({
        tier: z.enum(["frontier", "standard", "fast"]),
        model: z.string().optional(),
      }),
    )
    .default(() => ({}) as Record<string, never>),
  max_step_retries: z.number().int().min(0).default(3),
  max_task_iterations: z.number().int().min(1).default(15),
  stuck_detection: z.boolean().default(true),
});

export const SessionConfigSchema = z
  .object({
    session: z.object({
      name: z.string(),
      tracks: z.number().int().min(1).max(20),
      autonomy: z.enum(["full", "supervised", "assisted"]),
      token_budget_per_track: z.number().int().positive().optional(),
      started_at: z.string().datetime().nullable(),
      status: z.enum(["idle", "running", "paused", "reviewing"]),
    }),
    heartbeat: HeartbeatConfigSchema.optional(),
    loop: LoopConfigSchema.optional(),
    workflow: WorkflowConfigSchema.optional(),
  })
  .passthrough()
  .transform((data) => ({
    ...data,
    heartbeat: HeartbeatConfigSchema.parse(data.heartbeat ?? {}),
    loop: LoopConfigSchema.parse(data.loop ?? {}),
    workflow: WorkflowConfigSchema.parse(data.workflow ?? {}),
  }));
