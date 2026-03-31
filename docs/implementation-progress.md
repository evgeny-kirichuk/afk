# AFK — Implementation Progress

Progress tracking document. Check boxes as units are completed. Each unit is scoped to fit within one Claude Code session (~200k context).

---

## Phase 0: Architecture Validation Spikes

- [x] **P0.1a — SQLite session store**
  - `sessions`, `messages`, `events` tables with WAL mode and FK constraints
  - Full CRUD: create/update/get sessions, add messages and typed events, session tree queries
  - _Implemented: `packages/core/src/session-store.ts`_

- [x] **P0.1b — XState v5 machine + checkpoint/resume**
  - Define minimal task-level machine: `prep → implement → validate → commit`
  - Verify nested states (validate sub-states) and back-edge (review → implement loop)
  - Serialize XState snapshot to SQLite `snapshots` table after every transition
  - `restoreSnapshot(machineId)` reconstructs live actor from stored snapshot
  - _Success: Can restore exact machine state from SQLite after simulated `kill -9`_
  - _Implemented: `packages/core/src/machine.ts`, `saveSnapshot`/`restoreSnapshot` in `session-store.ts`_

- [x] **P0.2 — CLI abstraction spike**
  - Spawn Claude Code with `--output-format stream-json`
  - Parse NDJSON events into `AgentEvent` type
  - Verify tool-use in headless mode
  - _Success: Can spawn agent, capture events in real-time, detect completion_
  - _Implemented: `spike/cli-probe.ts`, `packages/core/src/parser.ts`, `packages/core/src/executor.ts`_

- [x] **P0.3 — Git worktree crash recovery spike**
  - Create/list/remove worktrees via `Bun.$` git commands
  - Parse `git worktree list --porcelain` output into typed records
  - Orphan detection: checks directory existence on disk (not git's list — git still reports deleted dirs until `prune`)
  - `git worktree prune` cleans up stale `.git/worktrees/<name>` metadata after crash
  - Lock file detection and removal via `unlockWorktree(repoPath, worktreeName)`
  - Path normalization handles macOS `/tmp` → `/private/tmp` symlink differences
  - _Success: Can detect and clean orphaned worktrees on startup_
  - _Implemented: `spike/worktree-spike.ts`, `tests/worktree-spike.test.ts`_

- [x] **P0.4 — Configuration loader** (`packages/core/src/config.ts`)
  - Discovers `afk.config.{ts,js,mjs,json,yaml}` in repo root or `~/.afk/config.yaml` via `c12`
  - Validates against `SessionConfigSchema` and merges Zod defaults for missing sections
  - Throws with a detailed error message on validation failure

- [x] **P0.5 — Prompt template renderer** (`packages/core/src/prompt-renderer.ts`)
  - Parses YAML frontmatter from step template files (`requires`, `tier`, custom fields)
  - Renders `{{placeholder}}` substitutions against a context dict
  - Claude-specific: splits output into `systemPrompt` + `userPrompt`; other providers get combined `userPrompt`
  - Throws if any `requires`-declared context key is absent from context

- [x] **P0.6 — Step runner** (`packages/core/src/step-runner.ts`)
  - Orchestrates full lifecycle of one step: create session → load template + spec → assemble context → render prompt → build provider invocation → execute → read `step_complete.json` → update session
  - Falls back gracefully: file missing + exit 0 → minimal `completed`; file missing + non-zero → `failed` with stderr
  - Supports parent session linking, provider session resume tokens, review context injection

---

## Phase 1: Core Deterministic Loop

**Goal:** Minimal end-to-end workflow execution with one provider (Claude Code)

### P1.1 — CLI Abstraction Layer

- [x] **P1.1a — Core types and provider interface**
  - `ProviderName`, `ModelTier`, `ProviderConfig`, `ProviderInvocation` types
  - `CLIProviderV1`-style interface and flag builders per provider
  - Model tier abstraction (`frontier/standard/fast → concrete models`)
  - `DEFAULT_CATALOG` with Claude, Codex, Gemini, Copilot entries
  - _Implemented: `packages/core/src/types.ts`, `packages/core/src/provider.ts`_

- [x] **P1.1b — NDJSON parser + AgentEvent normalization**
  - Parse Claude Code stream-json output into `AgentEvent` union
  - Extract token counts, session IDs, tool calls, result content
  - _Implemented: `packages/core/src/parser.ts`_

- [x] **P1.1c — Executor (process spawning + streaming)**
  - `execute()` wrapping `Bun.spawn()` for agent CLI processes
  - Real-time event streaming via `onEvent` callback
  - Timeout handling + `AbortSignal` support
  - Token accounting + duration tracking
  - _Implemented: `packages/core/src/executor.ts`_

### P1.2 — Workflow Engine

> **Note:** XState integration is _not yet started_. Current step-runner uses direct imperative logic. The workflow engine needs to be built to make execution deterministic and checkpointable.

- [ ] **P1.2a — XState v5 setup + minimal machine definition**
  - Install `xstate` v5
  - Define minimal task-level machine: `prep → implement → validate → commit`
  - Verify state transitions fire correctly in tests
  - _Prerequisite for P1.2b, P1.2c, P1.2d_

- [ ] **P1.2b — YAML workflow definition schema + loader**
  - Zod schema for workflow YAML (steps, transitions, conditions)
  - Parser: YAML → validated JS object
  - Converter: validated JS object → XState machine config
  - Ship built-in `default.yaml` task-level workflow
  - _Prerequisite for P1.2c_

- [ ] **P1.2c — Step transition logic in XState**
  - Map `step_complete.json` status (`completed / needs_input / failed`) to XState events
  - Wire needs-changes loop: review → implement (back-edge)
  - Error transitions (deterministic / transient / semantic / quota / fatal)
  - Restart counting per step
  - **⚠️ Resolve before implementing:** Loop explosion limits (arch §5.2) — decide between global task iteration cap, per-step limits, or phase-based limits. Without caps: 5 IMPLEMENT × 5 REVIEW rounds × (IMPLEMENT + CLEANUP + SIMPLIFY + REVIEW per round) = uncapped explosion. Recommended default: global `max_task_iterations` (already in `WorkflowConfigSchema`, default 15) as the single enforcement point; per-step retries use `max_step_retries` (default 3).

- [ ] **P1.2d — SQLite checkpointing for XState state**
  - Serialize XState snapshot to `sessions.db` after every transition
  - `resumeFromCheckpoint(sessionId)` reconstructs live machine from snapshot
  - Test: kill process mid-step, restart, verify machine resumes from last transition
  - _Success: state survives `kill -9`_

- [x] **P1.2e — Workflow step contract (input/output schemas)**
  - `StepOutputSchema` (Zod) for `step_complete.json`
  - `HeartbeatSchema` (Zod) for heartbeat files
  - `DecisionEntrySchema`, `TrackStateSchema`, `TaskSchema`, `ProjectSchema`
  - _Implemented: `packages/core/src/schemas.ts`, `packages/core/src/types.ts`_

### P1.3 — Git Worktree Manager

- [ ] **P1.3a — Worktree lifecycle (create / use / remove)**
  - `createWorktree(repoPath, branch, worktreePath)` via `Bun.$`
  - `removeWorktree(worktreePath)` with force-cleanup on lock
  - Naming convention: `afk/worktrees/<project-id>/`
  - _Prerequisite for P1.3b_

- [ ] **P1.3b — Project → worktree → branch mapping in DB**
  - `worktrees` table in `sessions.db` (`project_id`, `path`, `branch`, `status`)
  - Persist mapping on create, mark removed on cleanup
  - Query: `getWorktreeForProject(projectId)`

- [ ] **P1.3c — Startup reconciliation + orphan cleanup**
  - On supervisor start: compare DB rows against `git worktree list --porcelain`
  - Remove DB rows for worktrees that no longer exist on disk
  - Attempt `git worktree prune` for stale lock files
  - _Success: clean startup after `kill -9` with active worktrees_

### P1.4 — File-Based Protocol

- [x] **P1.4a — Core Zod schemas for agent-facing files**
  - `HeartbeatSchema`, `StepOutputSchema`, `DecisionEntrySchema`
  - `TrackStateSchema`, `TaskSchema`, `ProjectSchema`, `WorkflowConfig`
  - _Implemented: `packages/core/src/schemas.ts`_

- [ ] **P1.4b — Supervisor writes `step_input.json`**
  - Define `StepInputSchema` (step name, task context, memory snippets, repo-map placeholder)
  - `writeStepInput(afkDir, projectId, stepInput)` with atomic write
  - `readStepInput(afkDir, projectId)` with Zod validation
  - **⚠️ Resolve before implementing:** File protocol ownership (arch §5.1) — decide the directory layout for per-project files (`afk/projects/<id>/`) and which file is the single source of truth for decisions made during a step. Recommended: `step_complete.json` carries only status + summary + a flat `decisions[]` array (already in `StepOutputSchema`); `decisions.jsonl` is the append-only audit log written by the agent during execution. No duplication — `step_complete.json` does not reference JSONL entries.

- [ ] **P1.4c — File watcher for step completion detection**
  - Install `@parcel/watcher`
  - Watch `afk/projects/<id>/step_complete.json` for creation/change
  - Validate against `StepOutputSchema` on detection
  - Emit typed event to workflow engine (replaces polling in step-runner)

- [ ] **P1.4d — Atomic writes throughout**
  - Replace any non-atomic file writes with write-to-temp + rename pattern
  - Applies to: `step_input.json`, `step_complete.json`, `heartbeat.json`, `track_state.json`

### P1.5 — Heartbeat Supervision

> Schema is defined. The write/monitor loop is not yet implemented.

- [ ] **P1.5a — Agent-side heartbeat writer**
  - Agent writes `afk/projects/<id>/heartbeat.json` every 30s during step execution
  - Conforms to `HeartbeatSchema` (timestamp, pid, step, tokens, etc.)
  - Written by the prompt/agent scaffold injected into each step

- [ ] **P1.5b — Supervisor heartbeat monitor**
  - Poll (or watch) heartbeat file every N seconds
  - Compute staleness: `now - heartbeat.timestamp > threshold`
  - On stale: log warning, increment restart counter, re-spawn agent
  - Respect `maxRestarts` limit; escalate to `fatal` on breach

### P1.6 — Minimal Workflow Steps (Prompt Templates)

> `StepName` enum and `step-runner.ts` scaffolding exist. Individual step prompt templates are not yet authored.

- [ ] **P1.6a — PREP step prompt template**
  - Prompt: run existing tests, fix pre-existing failures, do not add new code
  - Template variables: `{{task_id}}`, `{{spec_summary}}`, `{{test_command}}`
  - Rendered by `prompt-renderer.ts`

- [ ] **P1.6b — IMPLEMENT step prompt template**
  - Prompt: implement spec, follow existing patterns, write tests alongside code
  - Template variables: task spec, memory snippets, repo-map (placeholder for Phase 4)

- [ ] **P1.6c — VALIDATE step (supervisor-driven)**
  - Supervisor runs test command + linter via `Bun.$` (no agent spawn)
  - Parse exit code + output → `completed` or `failed`
  - Write synthetic `step_complete.json` from result
  - Counts as a step transition in the XState machine

- [ ] **P1.6d — COMMIT step prompt template + supervisor assist**
  - Prompt: agent stages changes and writes commit message in specified format
  - Supervisor verifies commit was created (checks `git log` after step)
  - Commit message includes task ID + metadata

### P1.7 — Session Store (DB layer)

- [x] **P1.7a — Core session and message tables**
  - `sessions` table with status, step, tokens, iteration, review_round
  - `messages` table (role/content per session)
  - CRUD: `createSession`, `getSession`, `updateSession`, `addMessage`
  - _Implemented: `packages/core/src/session-store.ts`_

- [ ] **P1.7b — Track, task, and project tables**
  - `tracks` table (track_id, status, current_step, project_id)
  - `tasks` table (task_id, track_id, status, spec path, dependencies)
  - `projects` table (project_id, session_id, worktree path, branch)
  - Query helpers used by workflow engine and status CLI

- [ ] **P1.7c — Event stream table**
  - `events` table (session_id, type, payload JSON, created_at)
  - `appendEvent(sessionId, type, payload)` used after every state transition
  - Enables replay and audit

### P1.8 — CLI Commands (thin layer over core)

- [x] **P1.8a — `run-step` command scaffolding**
  - Wires `StepRunner` to CLI args
  - _Implemented: `packages/cli/src/commands/run-step.ts`_

- [ ] **P1.8b — `afk init` command**
  - Create `afk/` directory structure in current repo
  - Copy default workflow YAML from global defaults
  - Register repo in global SQLite (defer global daemon to Phase 6 — write local only for now)

- [ ] **P1.8c — `afk start` command**
  - Load task queue from `afk/tasks/`
  - Instantiate workflow engine, begin executing first task
  - Print live step progress to terminal

- [ ] **P1.8d — `afk status` command**
  - Read `sessions.db` + `track_state.json` files
  - Print table: task → current step → status → tokens used

- [ ] **P1.8e — Local dev install (compile + symlink)**
  - `bun build --compile` entry point → single `afk` binary
  - Install script: build + symlink to `/usr/local/bin/afk` (or `~/.local/bin/afk`)
  - `bun run dev` shortcut that runs from source without compiling
  - Version string embedded at build time from `package.json`
  - _Goal: `afk` command available globally for local testing from Phase 1 onwards_

### P1.9 — End-to-End Integration

- [ ] **P1.9a — Integration test: single task, happy path**
  - Fixture: simple task spec + fake agent (writes `step_complete.json` immediately)
  - Assert: workflow transitions prep → implement → validate → commit
  - Assert: session rows created + updated in DB
  - Assert: commit exists in git log

- [ ] **P1.9b — Integration test: agent crash + restart**
  - Fake agent crashes (exits 1) mid-step
  - Assert: supervisor detects stale heartbeat or non-zero exit
  - Assert: agent re-spawned, step retried
  - Assert: restart counter incremented in DB

- [ ] **P1.9c — Integration test: supervisor restart (kill -9 scenario)**
  - Start task, kill supervisor process, restart supervisor
  - Assert: workflow engine resumes from checkpointed XState snapshot
  - Assert: no duplicate commits, no orphaned worktrees

---

## Phase 2: Multi-Provider + Consensus

_(Not yet started — begin after Phase 1 success criteria met)_

- [ ] Codex adapter
- [ ] Gemini adapter
- [ ] Copilot adapter
- [ ] Provider registry + preference ordering
- [ ] Quota detection + backoff + failover
- [ ] Consensus slot-based fan-out
- [ ] Synthesis agent
- [ ] Per-step consensus config in workflow YAML

---

## Phase 3: Pipeline Workflows + Review + Re-Planning

_(Not yet started)_

- [ ] Pipeline engine (workflow chaining + state transfer)
- [ ] INTAKE workflow
- [ ] RESEARCH workflow
- [ ] AMEND workflow
- [ ] Review loop (REVIEW + DISTILL + stuck detection)
- [ ] REPLAN workflow + git revert capability
- [ ] Extended task-level steps (ANALYZE, TEST_PLAN, CLEANUP, SIMPLIFY)

---

## Phase 4: Memory + Context Management

_(Not yet started)_

- [ ] Layer 1: Always-loaded context files (MEMORY.md, active-context.md, ROUTER.md)
- [ ] Layer 2: tree-sitter repo map (port from Aider)
- [ ] Layer 3: Failure gates
- [ ] Context budget management (pre-step token estimation + truncation)

---

## Phase 5: Autonomy + Human Gates

_(Not yet started)_

- [ ] Autonomy mode config (full / supervised / assisted)
- [ ] Resume tokens (checkpoint serialization + CLI approve/deny)
- [ ] Notification system (Telegram outbound)

---

## Phase 6: Global Daemon + Integrations

_(Not yet started)_

- [ ] Global daemon (single process, multi-repo)
- [ ] Intake routing (ROUTE workflow)
- [ ] Repo scaffolding (`afk new`, `afk init`)
- [ ] Linear integration (polling + bi-directional sync)
- [ ] Security/sandboxing (hook-based policy engine)
- [ ] Exploration mode
- [ ] CLI polish (all commands, terminal UI for status)
- [ ] **Distribution + update pipeline**
  - Versioning: semver tags drive GitHub release artifacts
  - `bun build --compile --target=bun-darwin-arm64,bun-darwin-x64,bun-linux-x64` per platform
  - GitHub Actions: build + upload binaries on tag push
  - `afk update` self-update command (fetch latest binary from GitHub releases, replace self)
  - Install one-liner for new machines: `curl … | bash`

---

## Phase 7: macOS App (Optional)

_(Not yet started)_

- [ ] Tauri v2 app shell
- [ ] Live dashboard
- [ ] Decision graph visualization
- [ ] Review interface for gates
