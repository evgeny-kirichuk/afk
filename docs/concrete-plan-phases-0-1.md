# AFK CLI — Concrete Plan: Phases 0 & 1

---

## Phase 0 — Project Bootstrap

**Goal**: Monorepo compiles, all core types exist, Zod schemas validate the file protocol, a test passes. Nothing runs yet.

---

### 0.1 — Monorepo skeleton

**What gets created / changed:**

`package.json` (root) — update to Bun workspace root:
```json
{
  "name": "afk",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "bun build ./packages/cli/src/index.ts --compile --outfile afk --production --bytecode",
    "typecheck": "tsc --noEmit",
    "lint": "bunx biome check .",
    "format": "bunx biome format --write .",
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@biomejs/biome": "latest",
    "@tsconfig/bun": "latest",
    "typescript": "^5"
  }
}
```

`tsconfig.json` (root) — switch to extend `@tsconfig/bun`, add path alias:
```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@afk/core": ["./packages/core/src/index.ts"]
    }
  }
}
```

`bunfig.toml` (new):
```toml
[install]
exact = true

[test]
timeout = 15000
coverage = true
coverageReporter = ["text", "lcov"]
```

`biome.json` (new):
```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "semicolons": "always", "quoteStyle": "double" } }
}
```

`.gitignore` — append:
```
afk/tracks/
afk/graph/
afk/archive/
afk/repo-map.json
afk/inbox/.processed/
.afk-worktrees/
```

Delete `index.ts` (root — leftover from Bun starter).

`packages/core/package.json`:
```json
{
  "name": "@afk/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts"
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json"
}
```

`packages/cli/package.json`:
```json
{
  "name": "@afk/cli",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": { "afk": "./src/index.ts" },
  "dependencies": {
    "@afk/core": "workspace:*",
    "citty": "latest",
    "zod": "^4"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json"
}
```

`packages/cli/src/index.ts` — citty root command with stub subcommands:
```typescript
#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: { name: "afk", version: "0.0.1", description: "Supervisor for autonomous coding agents" },
  subCommands: {
    init: () => import("./commands/init").then((m) => m.default),
    start: () => import("./commands/start").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
  },
});

runMain(main);
```

`packages/cli/src/commands/init.ts`, `start.ts`, `status.ts` — all stubs:
```typescript
import { defineCommand } from "citty";
export default defineCommand({
  meta: { name: "init", description: "Initialize AFK in this repo" },
  run() { console.log("afk init — not yet implemented"); },
});
```

Run `bun install`.

**Verification**: `bun run packages/cli/src/index.ts --help` shows three subcommands.

---

### 0.2 — Type foundations (`packages/core/src/types.ts`)

Full vocabulary — everything the supervisor, executor, and tests speak:

```typescript
// ── Enums ────────────────────────────────────────────────────────────────────

export type StepName =
  | "prep" | "pick" | "analyze" | "test_plan" | "implement"
  | "cleanup" | "simplify" | "review" | "distill" | "validate"
  | "commit" | "explore";

export type TaskStatus =
  | "queued" | "in_progress" | "completed" | "failed" | "stalled" | "needs_input";

export type TrackStatus =
  | "starting" | "running" | "paused" | "failed" | "completed";

export type AutonomyMode = "full" | "supervised" | "assisted";

export type SessionStatus = "idle" | "running" | "paused" | "reviewing";

export type ErrorClass =
  | "deterministic"  // type error, lint failure — fix it
  | "transient"      // network, timeout — retry
  | "semantic"       // logic error — loop back to IMPLEMENT
  | "quota"          // API limit — wait/failover
  | "fatal";         // unknown — escalate

export type InputSource = "cli" | "inbox" | "linear" | "telegram";

export type ModelTier = "frontier" | "standard" | "fast";

export type PhaseType = "main" | "exploration";

export type DecisionType =
  | "task_start" | "decision" | "subtask_created" | "review" | "pivot"
  | "task_done" | "phase_change" | "exploration_finding" | "test_milestone"
  | "quota_hit" | "gate_reached";

// ── File Protocol Interfaces ──────────────────────────────────────────────────

export interface HeartbeatData {
  timestamp: string;          // ISO-8601
  pid: number;
  agent: string;              // "claude" | "codex" | "gemini"
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

export interface StepInput {
  step: StepName;
  task_id: string;
  track_id: string;
  session_id: string;
  spec_path: string;            // relative path to afk/context/specs/<id>.md
  review_context: ReviewFinding[] | null;  // populated when looping back from review
  memory_snippets: string[];    // injected from MEMORY.md, failure-gates, etc.
  iteration: number;
  model: string;
  tier: ModelTier;
}

export interface StepOutput {
  step: StepName;
  task_id: string;
  status: "completed" | "needs_input" | "failed";
  summary: string;
  decisions: DecisionEntry[];   // agent writes its own decisions, supervisor appends
  error?: string;
}

export interface ReviewFinding {
  persona: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  description: string;
  file?: string;
  line?: number;
}

export interface TaskEntry {
  id: string;
  title: string;
  status: TaskStatus;
  track: string | null;         // null = unclaimed
  spec_path: string | null;     // null = no spec yet (needs PARSE)
  source: InputSource;
  depends_on: string[];         // task IDs that must complete first
  created_at: string;
}

export interface TrackState {
  id: string;                   // "track-1", "track-2", etc.
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
  ts: string;                   // ISO-8601
  type: DecisionType;
  task: string;
  [key: string]: unknown;       // type-specific fields (see decisions.jsonl spec)
}

// ── Intake Pipeline ───────────────────────────────────────────────────────────

export interface IntakeEnvelope {
  id: string;                   // uuid
  source: InputSource;
  raw: string;                  // original text/content
  metadata: Record<string, unknown>;  // source-specific (linear ticket id, telegram message id, etc.)
  received_at: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface WorkflowStepConfig {
  tier: ModelTier;
  model?: string;               // pin a specific model, overrides tier
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
```

---

### 0.3 — Zod schemas (`packages/core/src/schemas.ts`)

Schemas validate every file the supervisor reads or writes. Runtime validation = crash loud, crash early.

```typescript
import { z } from "zod";

export const HeartbeatSchema = z.object({
  timestamp: z.string().datetime(),
  pid: z.number().int().positive(),
  agent: z.string(),
  step: z.enum(["prep","pick","analyze","test_plan","implement","cleanup",
                 "simplify","review","distill","validate","commit","explore"]),
  phase: z.enum(["main","exploration"]),
  task_id: z.string(),
  subtask: z.string().nullable(),
  iteration: z.number().int().min(0),
  review_round: z.number().int().min(0),
  tests: z.object({
    passing: z.number().int().min(0),
    failing: z.number().int().min(0),
    coverage_pct: z.number().min(0).max(100),
  }).nullable(),
  tokens_used: z.number().int().min(0),
  restarts: z.number().int().min(0),
  quota: z.object({
    status: z.enum(["ok","hit","recovering"]),
    hits: z.number().int().min(0),
    total_wait_seconds: z.number().min(0),
    last_hit_at: z.string().datetime().nullable(),
  }),
});

export const StepOutputSchema = z.object({
  step: z.enum(["prep","pick","analyze","test_plan","implement","cleanup",
                 "simplify","review","distill","validate","commit","explore"]),
  task_id: z.string(),
  status: z.enum(["completed","needs_input","failed"]),
  summary: z.string(),
  decisions: z.array(z.object({
    ts: z.string().datetime(),
    type: z.string(),
    task: z.string(),
  }).passthrough()),
  error: z.string().optional(),
});

export const DecisionEntrySchema = z.object({
  ts: z.string().datetime(),
  type: z.string(),
  task: z.string(),
}).passthrough();

// SessionConfigSchema — validate config.yaml after YAML parse
export const SessionConfigSchema = z.object({
  session: z.object({
    name: z.string(),
    tracks: z.number().int().min(1).max(20),
    autonomy: z.enum(["full","supervised","assisted"]),
    token_budget_per_track: z.number().int().positive().optional(),
    started_at: z.string().datetime().nullable(),
    status: z.enum(["idle","running","paused","reviewing"]),
  }),
  heartbeat: z.object({
    interval_seconds: z.number().positive().default(30),
    stall_threshold_seconds: z.number().positive().default(300),
    max_restarts_per_track: z.number().int().min(0).default(3),
  }),
  loop: z.object({
    review_rounds_min: z.number().int().min(1).default(2),
    review_rounds_max: z.number().int().min(1).default(5),
    test_coverage_required: z.boolean().default(true),
    exploration_mode: z.boolean().default(true),
    exploration_budget: z.number().int().positive().default(100_000),
  }),
  workflow: z.object({
    steps: z.record(z.object({
      tier: z.enum(["frontier","standard","fast"]),
      model: z.string().optional(),
    })).default({}),
    max_step_retries: z.number().int().min(0).default(3),
    max_task_iterations: z.number().int().min(1).default(15),
    stuck_detection: z.boolean().default(true),
  }),
}).passthrough();  // allow git, communication, linear sections to pass through unvalidated for now
```

---

### 0.4 — Config loader (`packages/core/src/config.ts`)

Reads `~/.afk/config.yaml` (global defaults) and `<cwd>/afk/config.yaml` (repo overrides), deep-merges them, validates with `SessionConfigSchema`.

```typescript
import { loadConfig } from "c12";
import { SessionConfigSchema } from "./schemas";

export async function loadAfkConfig(repoRoot: string) {
  const { config: raw } = await loadConfig({
    name: "afk",
    cwd: repoRoot,
    globalRc: true,           // loads ~/.afk/config.yaml
    dotenv: false,            // Bun auto-loads .env
    defaults: {
      session: { tracks: 1, autonomy: "supervised", started_at: null, status: "idle" },
      heartbeat: { interval_seconds: 30, stall_threshold_seconds: 300, max_restarts_per_track: 3 },
      loop: { review_rounds_min: 2, review_rounds_max: 5, test_coverage_required: true,
              exploration_mode: true, exploration_budget: 100_000 },
      workflow: { steps: {}, max_step_retries: 3, max_task_iterations: 15, stuck_detection: true },
    },
  });

  const result = SessionConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid afk config:\n${JSON.stringify(result.error.format(), null, 2)}`);
  }
  return result.data;
}
```

Add `c12` to `packages/core/package.json` dependencies.

---

### 0.5 — File protocol parser (`packages/core/src/parser.ts`)

CRUD for the file protocol. Every subsequent module calls into this.

**Decision on `tasks.md` format** (see Decision Points below): Use structured markdown with strict line format. Fail loudly on malformed lines.

```
# Tasks

## Queue
- [ ] auth-flow | spec:auth-flow | source:linear | track:- | depends:-
- [x] setup-db | spec:setup-db | source:cli | track:track-1 | depends:-

## Done
- [x] init-project | spec:init-project | source:cli | track:track-2 | depends:-

## Needs Input
- [?] "fix the login" | spec:- | source:telegram | track:- | depends:-
```

`parser.ts` provides:
- `readTasks(afkDir: string): Promise<TaskEntry[]>`
- `writeTasks(afkDir: string, tasks: TaskEntry[]): Promise<void>` — atomic write (temp + rename)
- `readSpec(afkDir: string, taskId: string): Promise<string>` — reads `afk/context/specs/<id>.md`
- `appendDecision(trackDir: string, entry: DecisionEntry): Promise<void>` — append line to `decisions.jsonl`
- `readHeartbeat(trackDir: string): Promise<HeartbeatData>` — reads + validates heartbeat.json
- `writeHeartbeat(trackDir: string, data: HeartbeatData): Promise<void>` — atomic write
- `writeStepInput(trackDir: string, input: StepInput): Promise<void>` — atomic write
- `readStepOutput(trackDir: string): Promise<StepOutput>` — reads + validates step_complete.json

All writes that may be read concurrently use atomic temp-file + rename pattern.

---

### 0.6 — Tests

`tests/core.test.ts` — validates the above works end-to-end:

```typescript
import { test, expect, describe } from "bun:test";
import { HeartbeatSchema, StepOutputSchema, SessionConfigSchema } from "@afk/core";

describe("HeartbeatSchema", () => {
  test("validates a valid heartbeat", () => {
    const result = HeartbeatSchema.safeParse({
      timestamp: "2026-03-15T03:42:00Z",
      pid: 48291, agent: "claude", step: "implementing", phase: "main",
      task_id: "auth-flow", subtask: null, iteration: 3, review_round: 2,
      tests: { passing: 47, failing: 2, coverage_pct: 82 },
      tokens_used: 124500, restarts: 0,
      quota: { status: "ok", hits: 0, total_wait_seconds: 0, last_hit_at: null },
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing required field", () => {
    const result = HeartbeatSchema.safeParse({ pid: 123 });
    expect(result.success).toBe(false);
  });
});

describe("SessionConfigSchema", () => {
  test("applies defaults for missing optional fields", () => {
    const result = SessionConfigSchema.safeParse({
      session: { name: "test", tracks: 2, autonomy: "full", started_at: null, status: "idle" },
      heartbeat: {}, loop: {}, workflow: {},
    });
    expect(result.success).toBe(true);
    expect(result.data?.heartbeat.interval_seconds).toBe(30);
  });
});
```

**Verification**: `bun test` — all tests pass.

---

### Phase 0 complete state

```
afk/
├── packages/
│   ├── core/src/
│   │   ├── types.ts       ✓ full type vocabulary
│   │   ├── schemas.ts     ✓ Zod schemas for all file formats
│   │   ├── config.ts      ✓ config loader (c12 + zod)
│   │   ├── parser.ts      ✓ file protocol CRUD
│   │   └── index.ts       ✓ barrel export
│   └── cli/src/
│       ├── index.ts       ✓ citty root command
│       └── commands/      ✓ stubs: init, start, status
├── tests/core.test.ts     ✓ schemas validated
├── bunfig.toml            ✓
├── biome.json             ✓
└── bun.lock               ✓
```

`bun test` — passes. `afk --help` — shows subcommands. Nothing actually runs yet.

---

## Phase 1 — Single Step Execution

**Goal**: `afk run-step implement --task auth-flow` spawns Claude, watches it work, sees `step_complete.json`. This is the atomic unit — everything else orchestrates sequences of this.

---

### 1.0 — Claude CLI spike (do this first, before writing any code)

**This is the most important investigation in the project.** The executor's design depends entirely on how `claude` actually takes input and produces output. Do not write `executor.ts` until this is confirmed with real tests.

Write a throwaway script `spike/claude-invocation.ts` and answer these questions:

**Q1: How does Claude CLI receive context?**
- Does it read from stdin? (`echo "prompt" | claude`)
- Does it accept a `--system-prompt` file? (`claude --system-prompt system.md`)
- Does it accept `--prompt`? (`claude --prompt "do X" --context file.md`)
- Can you pass a task spec file directly? (`claude @spec.md`)

**Q2: What's the output surface?**
- Does it write to stdout?
- Does it write to a file you specify?
- Is there a `--output file.json` flag?
- What format is the output — plain text, JSONL streaming, or a final JSON blob?

**Q3: How does it signal completion/failure?**
- What exit code on success? On quota hit? On context overflow? On hard crash?
- Is there parseable output on failure, or just stderr?

**Q4: How do you pass multiple context files?**
- Can you pass multiple `@file` references in a single invocation?
- Is there a `--context` flag that takes multiple files?

**Q5: What does quota-hit output look like?**
- Run `claude` with a prompt that triggers quota if possible, or check docs
- Capture exact stderr/exit code — this drives `error-classifier.ts`

**Spike method**:
```typescript
// spike/claude-invocation.ts
const result = await Bun.spawn(["claude", "--help"], { stdout: "pipe", stderr: "pipe" });
const out = await new Response(result.stdout).text();
console.log(out); // study the flags
```

Then try real invocations with increasing complexity until all 5 questions are answered. Write findings to `docs/claude-cli-invocation-findings.md` before writing any production code.

---

### 1.1 — Executor (`packages/core/src/executor.ts`)

Based on spike findings, implement the single-agent spawner:

```typescript
export interface ExecutorOptions {
  agentBinary: string;         // "claude", "codex", "gemini"
  systemPrompt: string;        // rendered step prompt (with context injected)
  workDir: string;             // worktree path — agent runs here
  env?: Record<string, string>;
  timeoutMs?: number;          // default: 1 hour
  signal?: AbortSignal;
}

export interface ExecutorResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function executeAgent(opts: ExecutorOptions): Promise<ExecutorResult> {
  // exact implementation depends on spike findings
  // likely: Bun.spawn with stdin containing rendered prompt
  // or: write prompt to temp file, pass as flag
}
```

Key Bun.spawn settings from research:
- Always pass `env` explicitly (Bun captures process.env at startup, not call time)
- Set `timeout` for hard kill on hung agents
- Use `signal` from AbortController for graceful cancel
- Set a `maxBuffer` to prevent runaway stdout

Write a test using a fake agent binary (a shell script that echoes known JSON) to verify the executor captures stdout, exit code, and duration correctly.

---

### 1.2 — Step prompt scaffolding

Create `afk/context/steps/` with prompt templates. Start with `implement.md` only — test it works before writing all 11.

**Decision on prompt format** (see Decision Points below): Use YAML frontmatter to declare context requirements, markdown body for the prompt. This makes the step runner self-documenting — it reads the frontmatter to know what to inject.

```markdown
---
requires:
  - spec
  - memory
  - repo_map
  - previous_step_output
tier: frontier
---
# Implement

You are implementing a coding task based on a specification. Your job is to write correct,
tested code. When done, write your completion status to `step_complete.json`.

## Spec
{{spec}}

## Memory
{{memory}}

## Previous Step Output
{{previous_step_output}}

## Instructions
...
```

Write a prompt renderer (`packages/core/src/prompt-renderer.ts`) that:
- Reads the frontmatter to get `requires` list
- Accepts a context map `{ spec: string, memory: string, ... }`
- Replaces `{{key}}` placeholders with values
- Returns the rendered string

---

### 1.3 — Step runner (`packages/core/src/step-runner.ts`)

Assembles context → calls executor → reads and validates output:

```typescript
export interface StepRunnerInput {
  step: StepName;
  taskId: string;
  trackDir: string;
  worktreeDir: string;
  afkDir: string;
  agentBinary: string;
  model: string;
}

export async function runStep(input: StepRunnerInput): Promise<StepOutput> {
  // 1. Read step prompt template from afkDir/context/steps/<step>.md
  // 2. Read spec from afkDir/context/specs/<taskId>.md
  // 3. Read memory from afkDir/MEMORY.md
  // 4. Read step_input.json from trackDir (supervisor-written context)
  // 5. Render prompt with all context injected
  // 6. Call executeAgent()
  // 7. Read step_complete.json from worktreeDir (agent-written output)
  // 8. Validate with StepOutputSchema
  // 9. Return typed StepOutput
}
```

Write a test: mock the executor (fake agent binary that writes a valid `step_complete.json`), verify runStep returns the correctly parsed output.

---

### 1.4 — `afk run-step` command

Replace the `start.ts` stub (or add as a separate command during development):

```
afk run-step <step> --task <task-id> --worktree <path> --afk-dir <path>
```

```typescript
import { defineCommand } from "citty";
import { runStep } from "@afk/core";

export default defineCommand({
  meta: { name: "run-step", description: "Run a single workflow step (development tool)" },
  args: {
    step: { type: "positional", description: "Step name (implement, review, etc.)" },
    task: { type: "string", required: true },
    worktree: { type: "string", required: true },
    "afk-dir": { type: "string", default: "./afk" },
  },
  async run({ args }) {
    const result = await runStep({
      step: args.step as StepName,
      taskId: args.task,
      trackDir: args.worktree,
      worktreeDir: args.worktree,
      afkDir: args["afk-dir"],
      agentBinary: "claude",
      model: "claude-sonnet-4-6",
    });
    console.log(JSON.stringify(result, null, 2));
  },
});
```

---

### Phase 1 milestone test

1. Create a test repo with a minimal `afk/` directory:
   - `afk/context/specs/add-sum.md` — spec: "Add a function `sum(a, b)` to `src/math.ts`"
   - `afk/context/steps/implement.md` — the implement step prompt
   - `afk/MEMORY.md` — minimal memory file
2. Run `afk run-step implement --task add-sum --worktree .`
3. Claude creates `src/math.ts` with the `sum` function
4. `step_complete.json` exists and passes `StepOutputSchema` validation

---

### Phase 1 complete state

```
packages/core/src/
├── types.ts          ✓ (from phase 0)
├── schemas.ts        ✓ (from phase 0)
├── config.ts         ✓ (from phase 0)
├── parser.ts         ✓ (from phase 0)
├── executor.ts       ✓ spawns agent CLI
├── prompt-renderer.ts ✓ renders step prompts
├── step-runner.ts    ✓ assembles + runs a single step
└── index.ts          ✓

packages/cli/src/commands/
├── run-step.ts       ✓ development/debug command
├── init.ts           stub
├── start.ts          stub
└── status.ts         stub

docs/
└── claude-cli-invocation-findings.md  ✓ spike results

afk/context/steps/
└── implement.md      ✓ first step prompt
```

---

## Decision Points

These are unresolved before implementation. Each requires a small spike before committing to an approach.

| # | Decision | Options | Recommendation | When to resolve |
|---|----------|---------|----------------|-----------------|
| 1 | **`tasks.md` format** | Strict markdown lines \| YAML frontmatter per task \| JSONL | Strict markdown (human-editable, louder on parse failure) | Phase 0.5 |
| 2 | **Claude CLI invocation** | stdin \| `--prompt` flag \| `@file` references | Unknown — spike required | **Phase 1.0 (first)** |
| 3 | **Step prompt format** | `{{placeholders}}` only \| YAML frontmatter + `{{placeholders}}` | YAML frontmatter (self-documenting context requirements) | Phase 1.2 |
| 4 | **Agent output surface** | stdout \| file write by agent \| both | Unknown — depends on spike | Phase 1.0 |

---

## What Is Explicitly Out of Scope for Phases 0–1

- Worktree creation (Phase 4)
- Heartbeat monitoring / supervisor loop (Phase 4)
- Review loop / error classifier (Phase 3)
- PARSE intake pipeline (Phase 5)
- Telegram, Linear (Phase 7)
- Memory system (Phase 8)
- `afk status` live dashboard (Phase 6)
- Tauri app (Phase 10)
