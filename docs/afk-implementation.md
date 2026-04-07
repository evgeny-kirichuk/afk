# Plan: AFK — Full Implementation

> Source PRD: `docs/afk-prd.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Runtime:** Bun (not Node). `Bun.serve()` for HTTP+SSE, `bun:sqlite` for storage, `Bun.spawn()` for agent processes, `Bun.$` for git commands.
- **Daemon:** Single Bun process on localhost. REST for commands, SSE for real-time events. All clients (CLI, TUI, desktop) are thin HTTP clients.
- **Database:** SQLite WAL mode. Global DB (`~/.afk/afk.db`) for repo registry. Per-repo DB (`<repo>/afk/sessions.db`) for execution state. Entity hierarchy: Session → Pipeline → Project → Task → Step → Invocation.
- **State machines:** XState v5. Two levels: pipeline-level (INTAKE → RESEARCH → AMEND → IMPLEMENTATION) and task-level (PREP → IMPLEMENT → VALIDATE → COMMIT, expandable). Snapshots persisted to SQLite for crash recovery.
- **File protocol:** Supervisor writes `step_input.json`, agent writes `step_complete.json`. Decisions in `decisions.jsonl`. All validated with Zod.
- **Git strategy:** One worktree per project, one branch per project, one atomic commit per task. `git revert` (never `git reset`) for rollbacks.
- **Config:** c12 merges global (`~/.afk/config.yaml`) → repo (`<repo>/afk/config.yaml`) → session (runtime). Workflows in `<repo>/afk/workflows/*.yaml`.
- **Provider model:** CLI abstraction over Claude Code, Codex, Gemini, Copilot. Neutral tiers (frontier/standard/fast) map to concrete models. Credential inheritance — each CLI manages its own auth.
- **CLI framework:** citty for command routing.
- **TUI framework:** OpenTUI for terminal dashboard.
- **Desktop framework:** Tauri v2 + React + Tailwind.
- **Monorepo structure:** `packages/core` (library), `packages/cli` (binary). Bun workspaces.

---

## Phase 1: Daemon HTTP Skeleton + CLI Init

**User stories**: US 2, 13

### What to build

A Bun.serve() HTTP+SSE server that starts on localhost and accepts basic commands from a thin CLI client. `afk daemon start` launches the server, `afk daemon stop` shuts it down, `afk init` registers the current repo in the global SQLite database, and `afk status` returns registered repos and daemon health. SSE endpoint streams events to connected clients. This is the communication backbone everything else builds on.

### Acceptance criteria

- [ ] `afk daemon start` launches HTTP+SSE server on a configurable localhost port
- [ ] `afk daemon stop` sends shutdown command and server exits cleanly
- [ ] `afk daemon status` reports whether daemon is running
- [ ] `afk init` registers current git repo in global DB (`~/.afk/afk.db`) with name, path, and registration time
- [ ] `afk status` lists all registered repos (name, path, status)
- [ ] SSE endpoint (`GET /events`) streams server lifecycle events (started, repo-registered) to connected clients
- [ ] CLI commands fail gracefully when daemon is not running
- [ ] REST endpoints return structured JSON responses

---

## Phase 2: Single Step Execution via File Protocol

**User stories**: US 2

### What to build

The file-based communication protocol between supervisor and agent. The supervisor writes `step_input.json` to a known directory, spawns a Claude Code process that reads it, and parses the resulting `step_complete.json` that the agent writes on completion. This phase wires the executor (already built) to the file protocol and proves one step can execute end-to-end through the daemon.

### Acceptance criteria

- [ ] Supervisor writes `step_input.json` with step name, task context, and relevant memory/instructions
- [ ] Executor spawns Claude Code in headless mode pointing at the step input file
- [ ] Agent output (NDJSON stream) is captured and parsed in real-time
- [ ] `step_complete.json` is read and validated against Zod schema on agent exit
- [ ] Decisions from the step are appended to `decisions.jsonl`
- [ ] Step execution is triggered via `afk start` with a single pre-written spec file
- [ ] Token usage (input/output/cached) extracted from agent output
- [ ] SSE events emitted for step-started, step-progress, step-completed

---

## Phase 3: Minimal Task Workflow

**User stories**: US 2

### What to build

The XState v5 task-level state machine orchestrating a minimal 4-step sequence: PREP → IMPLEMENT → VALIDATE → COMMIT. The step runner transitions the machine between states, invoking the executor for each step, passing outputs forward. PREP runs tests to establish baseline, IMPLEMENT executes the spec, VALIDATE runs tests/linter (supervisor-only, no agent), COMMIT creates the atomic commit (supervisor-only). This proves deterministic workflow orchestration end-to-end.

### Acceptance criteria

- [ ] XState task machine defines states for PREP, IMPLEMENT, VALIDATE, COMMIT with transitions
- [ ] Step runner advances machine state on step completion
- [ ] PREP step runs existing tests, reports baseline (failures noted for later comparison)
- [ ] IMPLEMENT step receives spec + baseline context, agent produces code changes
- [ ] VALIDATE step runs tests/linter without spawning an agent (supervisor executes directly)
- [ ] COMMIT step creates git commit without spawning an agent (supervisor executes directly)
- [ ] Machine halts on VALIDATE failure (for now — retry logic comes in Phase 10)
- [ ] Full sequence observable via `afk status` and SSE events
- [ ] Step prompt templates authored for PREP and IMPLEMENT

---

## Phase 4: Git Worktree + Commit Delivery

**User stories**: US 4, 26

### What to build

Git worktree lifecycle integrated into the task workflow. Before execution begins, a worktree is created on a new branch. All agent work happens inside the worktree. On COMMIT, an atomic commit is created with rich metadata (task ID, project name, step sequence, provider, model, tokens spent). After delivery, the worktree is cleaned up. This proves the isolation and delivery model.

### Acceptance criteria

- [ ] Worktree created automatically when a project starts, on a named branch (`afk/<session-id>/<project-name>`)
- [ ] Agent process is spawned with cwd set to the worktree path
- [ ] COMMIT step creates atomic commit with structured message containing task metadata
- [ ] Commit message includes: task ID, project name, provider used, model, tokens spent
- [ ] Worktree cleaned up after session completes (or on explicit cleanup command)
- [ ] Orphan worktree detection and cleanup on daemon start
- [ ] `afk status` shows active worktrees and their branches
- [ ] Branch is ready for PR creation or cherry-pick after completion

---

## Phase 5: Session Persistence + Token Tracking

**User stories**: US 15, 16

### What to build

Full relational entity hierarchy persisted in the per-repo SQLite database. Every session, pipeline, project, task, step, and invocation gets a row with parent references, timestamps, status, and token accounting. An append-only event stream table records all state transitions. Per-step token tracking (input/output/cached/thinking tokens) enables cost visibility. This is the observability backbone.

### Acceptance criteria

- [ ] Session, Pipeline, Project, Task, Step, Invocation tables with full relational integrity
- [ ] Foreign key constraints enforced (cascade deletes for cleanup)
- [ ] Every state transition recorded in events table with timestamp and data payload
- [ ] Per-invocation token tracking: input_tokens, output_tokens, cached_tokens, thinking_tokens, duration_ms
- [ ] Aggregate token queries: per-task total, per-session total, per-provider breakdown
- [ ] `afk status` includes token usage summary
- [ ] Event stream queryable by session, task, step, or time range
- [ ] All writes are transactional (no partial state on crash)

---

## Phase 6: TUI Dashboard

**User stories**: US 5, 13

### What to build

A k9s-style terminal dashboard using OpenTUI that connects to the daemon via SSE and provides live visibility into all AFK activity. Multi-panel layout showing repo list, active sessions, task progress, live agent logs, and token counters. Keyboard navigation for drilling down from repo → session → project → task → step. The TUI is a passive viewer — users execute commands via CLI in a separate terminal while watching progress in the TUI. This early investment in visibility pays off for every subsequent phase.

### Acceptance criteria

- [ ] `afk tui` launches the dashboard and connects to running daemon via SSE
- [ ] Main view: list of registered repos with active session indicators
- [ ] Session view: tasks in current session with status (pending/running/completed/failed)
- [ ] Task view: step-by-step progress with current step highlighted
- [ ] Log panel: live agent output streamed in real-time
- [ ] Token panel: running totals (per-step, per-task, per-session) updating live
- [ ] Keyboard navigation: arrow keys, enter to drill down, escape to go back, vim-style (j/k/h/l)
- [ ] Responsive layout adapts to terminal size
- [ ] Searchable decision log viewer (/ to search)
- [ ] Graceful handling of daemon disconnect/reconnect

---

## Phase 7: Agent Crash Recovery

**User stories**: US 10, 23

### What to build

Heartbeat-based supervision that detects stuck or crashed agents and auto-restarts them. The agent writes a heartbeat file at regular intervals proving liveness. The supervisor monitors heartbeat freshness and kills agents that go stale. On crash (process exit with non-zero) or stall (heartbeat stale), the supervisor restarts the step from the last checkpoint with modified context (e.g., "your previous attempt crashed, here's what was done so far"). Configurable restart budget per step.

### Acceptance criteria

- [ ] Agent writes heartbeat file every N seconds (configurable, default 30s)
- [ ] Supervisor polling loop detects heartbeat staleness (threshold configurable, default 90s)
- [ ] Stale heartbeat triggers agent kill (SIGTERM, then SIGKILL after grace period)
- [ ] Crashed agent (non-zero exit, no step_complete.json) triggers automatic restart
- [ ] Restart injects modified context: "previous attempt failed/stalled, here's partial progress"
- [ ] Restart budget enforced per step (default 3 attempts) — exceeded budget marks step failed
- [ ] All crash/restart events recorded in DB and visible in TUI
- [ ] Timeout enforcement per step (default 1 hour, configurable)

---

## Phase 8: Daemon Crash Recovery

**User stories**: US 11

### What to build

Daemon-level crash recovery via XState snapshot persistence. Before every state transition, the machine snapshot is written to SQLite. On daemon restart (whether manual or via launchd), all in-flight sessions are reconstructed from their snapshots and resumed from the exact point of interruption. This proves the "overnight reliability" guarantee — even a machine reboot doesn't lose progress.

### Acceptance criteria

- [ ] XState machine snapshot persisted to SQLite `snapshots` table on every state transition
- [ ] On `afk daemon start`, check for in-flight sessions in DB
- [ ] Reconstruct XState machines from persisted snapshots
- [ ] Resume all active sessions from their last checkpoint
- [ ] Running agents that were orphaned by daemon crash are detected and cleaned up
- [ ] launchd plist for auto-restart of daemon on crash (macOS)
- [ ] Recovery events logged and visible in TUI
- [ ] `afk status` indicates recovered sessions with time-since-interruption

---

## Phase 9: Multi-Task Dependency Queue

**User stories**: US 2

### What to build

Support for multiple tasks with dependency relationships within a project. Tasks are structured as a DAG — each task declares which other tasks it depends on. The PICK step (supervisor-only, no agent) selects the next ready task whose dependencies are all satisfied. Tasks execute in topological order, with independent tasks potentially queued sequentially (parallel execution comes in Phase 18).

### Acceptance criteria

- [ ] Task spec format includes `depends_on: [task-id, ...]` field
- [ ] PICK step evaluates dependency graph and selects next ready task
- [ ] Circular dependency detection at plan load time (reject with clear error)
- [ ] Tasks with satisfied dependencies execute in topological order
- [ ] Task completion updates dependency state for downstream tasks
- [ ] Failed task blocks all dependent tasks (marked as blocked, not failed)
- [ ] `afk status` shows task queue with dependency visualization
- [ ] TUI shows task DAG with completed/running/pending/blocked states
- [ ] Multiple specs in `<repo>/afk/tasks/` directory, each with metadata

---

## Phase 10: Full Default Workflow Steps

**User stories**: US 2

### What to build

The remaining step types that complete the default task workflow: ANALYZE (analyze requirements, identify approach — frontier tier), TEST_PLAN (write tests before implementation — standard tier), CLEANUP (remove dead code — fast tier), and SIMPLIFY (surface-level clarity — fast tier). Each step gets a prompt template. The full default sequence becomes: PREP → PICK → ANALYZE → TEST_PLAN → IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW → VALIDATE → COMMIT.

### Acceptance criteria

- [ ] ANALYZE step template authored: receives task spec, produces approach document
- [ ] TEST_PLAN step template authored: receives spec + analysis, produces test file(s)
- [ ] CLEANUP step template authored: reviews diff, removes dead code and obvious issues
- [ ] SIMPLIFY step template authored: reviews diff, applies surface-level clarity improvements
- [ ] REVIEW step template authored: evaluates diff with persona-based criteria, outputs approve/needs-changes
- [ ] Each step uses appropriate tier (frontier for ANALYZE/REVIEW, standard for TEST_PLAN, fast for CLEANUP/SIMPLIFY)
- [ ] Full 10-step sequence executes end-to-end for a single task
- [ ] Step outputs flow forward correctly (analysis → test_plan → implement → cleanup → simplify → review)
- [ ] All steps visible and trackable in TUI with per-step token costs

---

## Phase 11: Review Loop + Stuck Detection

**User stories**: US 6 (partial)

### What to build

The review feedback loop: when REVIEW outputs `needs-changes`, the workflow loops back to IMPLEMENT with the review feedback injected into context, then through CLEANUP → SIMPLIFY → REVIEW again. Diff-based stuck detection compares consecutive iteration outputs — if the diff is identical, the loop is considered stuck and terminated. Phase-based iteration budgets cap each loop: main phase (IMPLEMENT attempts), review phase (REVIEW rounds), validation phase (VALIDATE retries), global task budget (total invocations).

### Acceptance criteria

- [ ] REVIEW step outputs structured verdict: `approve` or `needs-changes` with specific feedback
- [ ] `needs-changes` triggers transition back to IMPLEMENT with review feedback in context
- [ ] IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW cycle repeats until approved or budget exhausted
- [ ] Diff-based stuck detection: if two consecutive iterations produce identical diffs, loop is killed
- [ ] Main phase budget: max N IMPLEMENT attempts (default 3, configurable)
- [ ] Review phase budget: max N REVIEW rounds (default 5, configurable)
- [ ] Validation phase budget: max N VALIDATE retries (default 3, configurable)
- [ ] Global task budget: max total invocations per task (default 20, configurable)
- [ ] Budget exhaustion marks task as failed with reason, escalates to human
- [ ] TUI shows iteration count and budget remaining per task

---

## Phase 12: Custom Workflow YAML

**User stories**: US 12

### What to build

User-defined workflow compositions from the built-in step catalog. Users create YAML files in `<repo>/afk/workflows/` that define custom step sequences with per-step configuration overrides (tier, consensus enable/disable, iteration limits). A bugfix workflow might skip ANALYZE and TEST_PLAN. Workflows are validated at load time against the step catalog. The `afk start` command accepts a `--workflow` flag to select which workflow to use.

### Acceptance criteria

- [ ] Workflow YAML schema defined and documented
- [ ] YAML files in `<repo>/afk/workflows/` are discovered and loaded
- [ ] Validation rejects unknown step names, invalid tier overrides, malformed YAML
- [ ] Per-step config overrides: tier, consensus, iteration limits, timeout
- [ ] Built-in `default` and `bugfix` workflows ship as reference examples
- [ ] `afk start --workflow bugfix` uses the bugfix step sequence
- [ ] Workflows loaded fresh per execution (edit YAML, re-run, new workflow applies)
- [ ] `afk status` shows which workflow is active for each task
- [ ] Error messages clearly identify YAML validation failures with line numbers

---

## Phase 13: INTAKE: PRD Decomposition

**User stories**: US 3

### What to build

The INTAKE workflow that accepts a PRD document and produces a structured plan. Input classification determines the type (task/bug/PRD/research/vague). For PRDs, a decomposition agent breaks the document into a project/task DAG with per-task specs. Research flags are detected for areas needing deeper investigation. Simple tasks get direct specs (bypassing research). This is triggered by `afk handoff <prd.md>`.

### Acceptance criteria

- [ ] `afk handoff <prd.md>` sends PRD content to daemon
- [ ] Input classification: single task, bug report, PRD, research question, vague (reject with guidance)
- [ ] PRD decomposition produces project/task DAG with dependency ordering
- [ ] Per-task spec generated with: description, acceptance criteria, dependencies, estimated complexity
- [ ] Research flags detected: technology choices, integration unknowns, multiple viable approaches
- [ ] Simple/obvious tasks get direct specs (no research flag)
- [ ] Decomposition result stored in DB and visible in TUI
- [ ] Task specs written to `<repo>/afk/tasks/` directory
- [ ] Decomposition agent uses frontier tier

---

## Phase 14: RESEARCH: Parallel Investigation

**User stories**: US 19, 21

### What to build

The RESEARCH workflow that investigates flagged unknowns. A planning agent decomposes each research question into a sub-question DAG. Independent sub-questions are investigated by parallel sub-agents with web search capabilities, running search-evaluate-refine loops. A synthesis agent merges all findings into a structured report. Also available standalone via `afk research <question>`.

### Acceptance criteria

- [ ] Research question decomposed into sub-question DAG by planning agent
- [ ] Independent sub-questions investigated in parallel by separate agent spawns
- [ ] Each sub-agent has access to web search tools
- [ ] Sub-agents run search-evaluate-refine loops (iteration-capped)
- [ ] Synthesis agent (frontier tier) merges all findings into unified report
- [ ] Structured research report written to `<repo>/afk/research/` directory
- [ ] `afk research <question>` runs standalone research workflow
- [ ] Configurable: sub-question budget, per-agent tool call budget, effort level
- [ ] Research progress visible in TUI with per-sub-question status
- [ ] All research invocations tracked with token accounting in DB

---

## Phase 15: Pipeline Orchestration + AMEND

**User stories**: US 3

### What to build

The pipeline-level XState state machine that chains workflows: INTAKE → RESEARCH → AMEND → IMPLEMENTATION. The AMEND workflow receives the original plan plus research findings and adjusts task specs accordingly (update estimates, refine approaches, add/remove tasks based on research). State transfer between workflow stages carries forward accumulated context. The full `afk handoff` pipeline now runs end-to-end.

### Acceptance criteria

- [ ] Pipeline-level XState machine with states: INTAKE, RESEARCH, AMEND, IMPLEMENTATION
- [ ] Transitions carry forward: original PRD, decomposition result, research reports
- [ ] AMEND agent receives: original plan, research findings, and produces updated plan
- [ ] AMEND can: update task specs, reorder tasks, add new tasks, remove tasks, adjust dependencies
- [ ] Updated plan replaces original in DB and task directory
- [ ] IMPLEMENTATION phase uses amended plan
- [ ] Pipeline state persisted to SQLite (crash-recoverable)
- [ ] Skip RESEARCH/AMEND when no research flags detected (direct to IMPLEMENTATION)
- [ ] Full pipeline observable in TUI with per-stage progress
- [ ] Pipeline-level trace correlation (shared trace ID across all stages)

---

## Phase 16: Multi-Provider Failover

**User stories**: US 7

### What to build

Automatic provider failover when one hits quota limits or errors. The provider layer detects quota/rate-limit patterns from CLI output (each CLI has different error formats). On detection, the executor automatically retries with the next provider in the configured preference list. Provider used is tracked per invocation for cost and reliability analysis.

### Acceptance criteria

- [ ] Quota detection patterns defined for each provider (Claude, Codex, Gemini, Copilot)
- [ ] On quota/rate-limit detection, current step retried with next provider in preference list
- [ ] Provider preference list configurable in config.yaml (global and per-repo)
- [ ] Failover is transparent — step continues without user intervention
- [ ] If all providers exhausted, step marked as failed with "all providers quota-limited"
- [ ] Provider used recorded per invocation in DB
- [ ] `afk status` shows provider usage breakdown
- [ ] TUI shows provider switches in real-time
- [ ] Transient errors (network, 500s) also trigger failover after retry budget

---

## Phase 17: Consensus Engine

**User stories**: US 8

### What to build

Slot-based fan-out for consensus-enabled steps (e.g., ANALYZE). The supervisor spawns N agents in parallel, each with a different provider, analyzing the same task independently. A synthesis agent (frontier tier) receives all N analyses and merges them into a unified, enriched output that benefits from multiple perspectives. The IMPLEMENT step then receives this consensus-enriched context.

### Acceptance criteria

- [ ] Consensus mode configurable per step in workflow YAML (`consensus: true`, `slots: 3`)
- [ ] Supervisor spawns N agents in parallel with per-slot provider assignment
- [ ] Each agent receives identical input, produces independent analysis
- [ ] Per-slot timeout (configurable, default 10 minutes)
- [ ] Synthesis agent (frontier tier) merges all completed analyses
- [ ] Synthesis output is richer than any individual analysis
- [ ] IMPLEMENT receives consensus-enriched context
- [ ] Partial consensus: if some slots timeout, synthesis uses available results
- [ ] All consensus invocations tracked in DB with shared parent span ID
- [ ] Consensus progress visible in TUI (N slots, completion status per slot)

---

## Phase 18: Re-planning + Revert

**User stories**: US 6, 27

### What to build

Mid-execution plan invalidation detection and recovery. An agent can signal plan invalidation via step output. The supervisor pauses the affected project, invokes a re-plan agent that identifies tainted commits, executes `git revert` (preserving history) for each tainted task, and produces a reconciled plan. Reverted tasks are re-queued with updated specs. Re-planning can chain to RESEARCH if new unknowns emerge. Budget enforced: max N re-plans per session.

### Acceptance criteria

- [ ] Agent can signal plan invalidation via `step_complete.json` status field
- [ ] Review scope creep and dependency contradictions also trigger re-plan
- [ ] Supervisor pauses project and invokes re-plan agent
- [ ] Re-plan agent receives: original PRD, current plan with completion status, evidence of breakage, git log, repo map
- [ ] Re-plan output: list of tainted tasks (to revert), updated/new task specs
- [ ] `git revert` applied per tainted task commit (history preserved, no `git reset`)
- [ ] Reverted tasks re-queued with updated specs, new tasks added to DAG
- [ ] Re-plan can chain to RESEARCH → AMEND if new unknowns emerge
- [ ] Replan budget enforced: max N per session (default 3, configurable)
- [ ] Full revert/replan history tracked in DB and visible in TUI

---

## Phase 19: Multi-Project Parallelism

**User stories**: US 9

### What to build

Multiple projects from a single session running in parallel on separate worktrees. When INTAKE decomposes a PRD into multiple projects, each gets its own worktree, branch, and independent task queue. Projects execute concurrently with no interference. Shared context (research reports, memory, specs) is accessible to all projects. Each project produces an independently mergeable branch.

### Acceptance criteria

- [ ] INTAKE decomposition can produce multiple projects from one PRD
- [ ] Each project gets its own worktree and branch
- [ ] Projects execute in parallel (concurrent agent processes)
- [ ] No filesystem interference between parallel projects (worktree isolation)
- [ ] Shared research reports and memory files accessible to all projects
- [ ] Each project produces independently mergeable branch
- [ ] Per-project status in `afk status` and TUI
- [ ] Per-project token accounting (not just per-session aggregate)
- [ ] One project failing doesn't block or affect others
- [ ] Configurable max concurrent projects (to manage system resources)

---

## Phase 20: Context Assembly + Budget Management

**User stories**: US 29

### What to build

Dynamic context assembly at agent spawn time from multiple sources: always-loaded files (MEMORY.md, active-context.md), task spec, step-specific instructions, previous step outputs, and decision history. Token budget estimation before spawning — if assembled context exceeds model limits, truncation and prioritization rules apply (most relevant context kept, older decisions summarized). Per-model budget adjustment since different models have different context windows.

### Acceptance criteria

- [ ] Context assembled from multiple layers: always-loaded, task spec, step instructions, prior outputs, decisions
- [ ] Token count estimation before spawning (fast approximate count)
- [ ] If over budget: truncation rules applied (prioritize spec > recent decisions > memory > older history)
- [ ] Per-model context budgets (different limits for frontier/standard/fast tiers)
- [ ] Context budget configurable per step in workflow YAML
- [ ] Warning emitted when context is truncated (visible in TUI and logs)
- [ ] No agent spawn fails due to context overflow (budget enforced pre-spawn)
- [ ] Context composition logged for debugging (what was included/excluded)

---

## Phase 21: Tree-sitter Repo Map

**User stories**: US 28

### What to build

Structural code index via tree-sitter, ported from Aider's approach. Parse the codebase into a symbol graph (functions, classes, imports, exports). Rank symbols by relevance to the current task using graph-based heuristics (call distance, edit proximity). Inject a concise repo map into agent context showing the most relevant structural information. Regenerate the index automatically after commits.

### Acceptance criteria

- [ ] Tree-sitter parses supported languages into symbol graph
- [ ] Symbol types: functions, classes, methods, imports, exports, type definitions
- [ ] Graph-based relevance ranking: symbols closer to task-relevant files ranked higher
- [ ] Concise repo map format injected into step prompts
- [ ] Repo map respects context budget (truncates to fit)
- [ ] Index regenerated automatically after each commit
- [ ] Index cached on disk for fast startup (rebuild only on changes)
- [ ] Languages supported: TypeScript, JavaScript, Python, Go, Rust (at minimum)
- [ ] `afk status` shows repo map stats (files indexed, symbols extracted)

---

## Phase 22: Failure Gates

**User stories**: US 30

### What to build

Persistent error-based behavior modification. When a step fails due to a specific cause (flaky test, known bad pattern, unreliable API), the failure is recorded as a "gate" that modifies supervisor behavior in future steps and sessions. Gates are stored globally (max 20), have expiry, and can be manually added/removed. Example: "test X is flaky — skip it in VALIDATE" or "never use approach Y for this type of task."

### Acceptance criteria

- [ ] Failure gate schema: trigger condition, behavior modification, source (auto/manual), expiry
- [ ] Automated gate creation: repeated step failures on same cause → gate proposed
- [ ] Manual gate management: `afk gate add "skip test X in VALIDATE"`, `afk gate list`, `afk gate remove <id>`
- [ ] Gates injected into step context as supervisor instructions
- [ ] Max 20 active gates (oldest evicted when limit reached, or manual cleanup)
- [ ] Gates persist across sessions (stored in global DB)
- [ ] Gate effectiveness tracked: did the gate prevent the failure it was created for?
- [ ] Gates visible in TUI with hit count and last-triggered timestamp
- [ ] Expiry-based cleanup (configurable TTL, default 7 days)

---

## Phase 23: Autonomy Modes + Resume Tokens

**User stories**: US 18, 24

### What to build

Variable autonomy levels that control where the workflow pauses for human approval. Three modes: full (no gates), supervised (pauses at configured steps), assisted (pauses at every step). Per-step gate configuration in workflow YAML. When a gate is hit, the workflow serializes its checkpoint and generates a unique resume token. The token can be approved or denied from any surface (CLI, TUI, Telegram). Autonomy mode is switchable mid-session.

### Acceptance criteria

- [ ] Three autonomy modes: full, supervised, assisted
- [ ] Per-step gate configuration in workflow YAML (`gate: true/false`)
- [ ] Default supervised gates: before IMPLEMENT, before COMMIT, on re-plan
- [ ] Gate hit: workflow pauses, checkpoint serialized, resume token generated
- [ ] Resume token displayed in TUI and optionally sent to external channels
- [ ] `afk approve <token>` resumes from exact checkpoint
- [ ] `afk deny <token> --reason "..."` cancels with recorded reason
- [ ] Gate hit includes: what's about to happen, relevant context, diff preview
- [ ] Mid-session autonomy switch: `afk autonomy <session-id> full|supervised|assisted`
- [ ] All gate decisions recorded in DB with timestamp, surface, and approver

---

## Phase 24: Multi-Repo Management

**User stories**: US 9, 13

### What to build

Global daemon managing multiple repos simultaneously. Repo registry with aliases for routing. Incoming work dispatched to the correct repo by name or alias. `afk new <name>` scaffolds a new repo and registers it. Cross-repo status provides a single pane of glass across all projects. Daemon manages concurrent sessions across different repos.

### Acceptance criteria

- [ ] Multiple repos registered with `afk init` across different directories
- [ ] Repo aliases configurable (e.g., "api" → "/Users/me/Projects/backend-api")
- [ ] `afk status` shows cross-repo overview (all repos, all active sessions)
- [ ] `afk start --repo <name>` dispatches work to specific repo
- [ ] `afk handoff --repo <name> <prd.md>` routes PRD to correct repo
- [ ] `afk new <name>` scaffolds new git repo, initializes AFK config, registers with daemon
- [ ] Concurrent sessions across different repos (isolated execution)
- [ ] Per-repo token accounting in status view
- [ ] TUI shows multi-repo overview with drill-down per repo
- [ ] Repo health check on daemon start (verify paths exist, git repos valid)

---

## Phase 25: Telegram Bot

**User stories**: US 14

### What to build

Telegram bot integration for remote dispatch and monitoring. `/handoff <repo> <prd>` dispatches work to AFK. `/status` returns current session state. `/new <name> <prd>` creates and starts a new project. Outbound notifications for: gate hits (with approve/deny buttons), session completion, errors. Resume tokens approvable via Telegram inline buttons.

### Acceptance criteria

- [ ] Telegram bot configured via token in global config
- [ ] `/handoff <repo> <prd>` dispatches PRD to specified repo
- [ ] `/status` returns formatted status of all active sessions
- [ ] `/new <name> <prd>` scaffolds repo and starts work
- [ ] `/research <question>` triggers standalone research
- [ ] Outbound notification on gate hit with inline approve/deny buttons
- [ ] Outbound notification on session completion with summary
- [ ] Outbound notification on error with context
- [ ] Messages formatted for readability (Telegram markdown)
- [ ] Bot handles multiple users (configurable allowed user IDs)

---

## Phase 26: Linear Integration

**User stories**: US 25

### What to build

Bidirectional Linear integration. AFK polls for tickets tagged `afk-ready`, picks them up, and executes. Status updates synced back to Linear (in-progress, completed, failed). Project→repo routing via configurable alias mapping. Ticket content becomes the task spec. Labels and priority preserved.

### Acceptance criteria

- [ ] Linear API key configured in global config
- [ ] Polling for tickets with `afk-ready` label (configurable interval)
- [ ] Ticket content extracted as task spec
- [ ] Project→repo routing via configurable mapping (Linear project → AFK repo alias)
- [ ] Status synced to Linear: picked-up → in-progress → completed/failed
- [ ] Completion comment on Linear ticket with: branch name, commit SHA, token usage
- [ ] Failed ticket updated with error summary
- [ ] Multiple Linear projects mappable to different repos
- [ ] Polling interval configurable (default 5 minutes)
- [ ] Deduplication: same ticket not picked up twice

---

## Phase 27: Security Policy Engine

**User stories**: US 17

### What to build

Hook-based security policy engine following Claude Code's PreToolUse pattern. Every tool call is intercepted before execution. Unified policy evaluation across four layers: global (`~/.afk/policy.yaml`) → repo (`<repo>/afk/policy.yaml`) → session → step. Deny always wins. PolicyStatement schema with effect (allow/deny), resources (glob patterns), actions (read/write/bash/git), and conditions. Structured audit log of every policy decision. Scoped secret injection at spawn time.

### Acceptance criteria

- [ ] Policy YAML schema defined: effect, resources, actions, conditions
- [ ] Policy files loaded from 4 layers: global, repo, session, step
- [ ] Deny at any layer blocks the action (deny-wins logic)
- [ ] Resource matching via glob patterns (e.g., `**/secrets/**` denies read)
- [ ] Action types: read, write, bash, git, network
- [ ] Every policy evaluation logged to structured audit log
- [ ] Audit log queryable by session, step, action, decision
- [ ] Secret management: scoped env vars injected per step
- [ ] Secrets not leaked in logs or agent output (scrubbing)
- [ ] Policy violations visible in TUI with blocked action details
- [ ] `afk policy check <action> <resource>` dry-run command

---

## Phase 28: Exploration Mode

**User stories**: US 22

### What to build

When task queues are empty and the daemon has idle compute capacity, trigger an exploration mode. Exploration agents run with standard tier, looking for bugs, code smells, improvement opportunities, or missing test coverage. Findings are committed on clearly tagged exploratory branches (`afk/explore/<timestamp>`). These are proposals, not production changes — user reviews and cherry-picks what's valuable.

### Acceptance criteria

- [ ] Exploration triggers automatically when all task queues empty
- [ ] Configurable: enable/disable, max exploration budget (tokens), cooldown between explorations
- [ ] Exploration agent receives: repo map, recent commit history, project conventions
- [ ] Exploration types: bug finding, code smell detection, test coverage gaps, security audit
- [ ] Findings committed on tagged branches (`afk/explore/<type>/<timestamp>`)
- [ ] Commits clearly marked as exploratory (metadata tag)
- [ ] Exploration results summarized in notification (Telegram/TUI)
- [ ] Exploration budget tracked separately from task budgets
- [ ] Exploration can be manually triggered: `afk explore [--type bug|smell|test|security]`
- [ ] Exploration paused immediately when new task work arrives

---

## Phase 29: Desktop App

**User stories**: US 20

### What to build

Native macOS desktop application using Tauri v2 with React + Tailwind frontend. Connects to the daemon via HTTP+SSE (same protocol as CLI/TUI). Multi-repo tabs showing live dashboards. Decision graph visualization showing the full execution tree (pipeline → project → task → step) with status coloring. Review interface for approval gates with diff preview. Session reports with cost breakdown. Launches daemon automatically on app start if not running.

### Acceptance criteria

- [ ] Tauri v2 app builds and runs on macOS
- [ ] Auto-starts daemon on launch if not already running
- [ ] Multi-repo tabs (one tab per registered repo)
- [ ] Live dashboard updates via SSE (same data as TUI)
- [ ] Decision graph: visual tree of pipeline → project → task → step with status colors
- [ ] Review interface: diff preview, context, approve/deny buttons for gates
- [ ] Session reports: token usage, cost breakdown, timeline, provider distribution
- [ ] Reports exportable (JSON/PDF)
- [ ] Notification integration (macOS native notifications for gate hits, completions, errors)
- [ ] Settings panel for global config editing
