// ── Enums ─────────────────────────────────────────────────────────────────────

export type StepName =
  | "prep"
  | "pick"
  | "analyze"
  | "test_plan"
  | "implement"
  | "cleanup"
  | "simplify"
  | "review"
  | "distill"
  | "validate"
  | "commit"
  | "explore";

export type TaskStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "stalled"
  | "needs_input";

export type TrackStatus = "starting" | "running" | "paused" | "failed" | "completed";

export type AutonomyMode = "full" | "supervised" | "assisted";

export type SessionStatus = "idle" | "running" | "paused" | "reviewing";

export type ErrorClass =
  | "deterministic" // type error, lint failure → fix it
  | "transient" // network, timeout → retry
  | "semantic" // logic error → loop back to IMPLEMENT
  | "quota" // API rate limit → wait / failover
  | "fatal"; // unknown → escalate

export type InputSource = "cli" | "inbox" | "linear" | "telegram";

export type ModelTier = "frontier" | "standard" | "fast";

export type PhaseType = "main" | "exploration";

export type DecisionType =
  | "task_start"
  | "decision"
  | "subtask_created"
  | "review"
  | "pivot"
  | "task_done"
  | "phase_change"
  | "exploration_finding"
  | "test_milestone"
  | "quota_hit"
  | "gate_reached";

// ── File Protocol Interfaces ───────────────────────────────────────────────────

export interface HeartbeatData {
  timestamp: string; // ISO-8601
  pid: number;
  agent: string; // "claude" | "codex" | "gemini"
  step: StepName;
  phase: PhaseType;
  task_id: string;
  subtask: string | null;
  iteration: number;
  review_round: number;
  tests: { passing: number; failing: number; coverage_pct: number } | null;
  tokens_used: number;
  restarts: number;
  quota: {
    status: "ok" | "hit" | "recovering";
    hits: number;
    total_wait_seconds: number;
    last_hit_at: string | null;
  };
}

export interface ReviewFinding {
  persona: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  description: string;
  file?: string;
  line?: number;
}

export interface StepInput {
  step: StepName;
  task_id: string;
  track_id: string;
  session_id: string;
  spec_path: string; // relative: afk/context/specs/<id>.md
  review_context: ReviewFinding[] | null;
  memory_snippets: string[];
  iteration: number;
  model: string;
  tier: ModelTier;
}

export interface StepOutput {
  step: StepName;
  task_id: string;
  status: "completed" | "needs_input" | "failed";
  summary: string;
  decisions: DecisionEntry[];
  error?: string;
}

export interface TaskEntry {
  id: string;
  title: string;
  status: TaskStatus;
  track: string | null; // null = unclaimed
  spec_path: string | null; // null = needs PARSE
  source: InputSource;
  depends_on: string[];
  created_at: string;
}

export interface TrackState {
  id: string; // "track-1", "track-2", …
  pid: number | null;
  status: TrackStatus;
  current_step: StepName | null;
  current_task: string | null;
  review_round: number;
  iteration: number;
  restarts: number;
  worktree_path: string;
  branch: string;
}

export interface DecisionEntry {
  ts: string;
  type: DecisionType;
  task: string;
  [key: string]: unknown; // type-specific extra fields
}

export interface IntakeEnvelope {
  id: string;
  source: InputSource;
  raw: string;
  metadata: Record<string, unknown>;
  received_at: string;
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface WorkflowStepConfig {
  tier: ModelTier;
  model?: string;
}

export interface AutonomyModeConfig {
  human_gates: string[];
  auto_commit: boolean;
  auto_advance_on_review_cap: boolean;
  escalation: "log" | "block_and_notify";
  linear_status_auto_update: boolean;
}

export interface SessionConfig {
  session: {
    name: string;
    tracks: number;
    autonomy: AutonomyMode;
    token_budget_per_track?: number;
    started_at: string | null;
    status: SessionStatus;
  };
  autonomy_modes: Record<AutonomyMode, AutonomyModeConfig>;
  git: {
    local_changes: "stash" | "commit-wip" | "fail";
    branch_prefix: string;
    worktree_root: string;
    base_branch: string;
  };
  heartbeat: {
    interval_seconds: number;
    stall_threshold_seconds: number;
    max_restarts_per_track: number;
  };
  loop: {
    review_rounds_min: number;
    review_rounds_max: number;
    test_coverage_required: boolean;
    exploration_mode: boolean;
    exploration_budget: number;
  };
  workflow: {
    steps: Partial<Record<StepName, WorkflowStepConfig>>;
    max_step_retries: number;
    max_task_iterations: number;
    stuck_detection: boolean;
  };
}
