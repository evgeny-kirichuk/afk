# AFK — Product Requirements Document

## Problem Statement

Developers who want to leverage autonomous coding agents (Claude Code, Codex, Gemini CLI, Copilot CLI) for complex, multi-task work face a fundamental gap: no existing tool combines deterministic orchestration, multi-provider support, git worktree isolation, multi-repo management, and overnight reliability into a single system.

Today, if you want an AI agent to implement a multi-task PRD overnight, you must:
- Manually decompose the PRD into tasks and feed them one at a time
- Babysit the agent for crashes, quota exhaustion, and context rot
- Hope the agent doesn't silently go off-track with no way to detect or recover
- Manage git branches and merges manually
- Restart everything from scratch if the machine reboots
- Repeat all of this per repository

The result: developers either scope down to trivial single-task requests (underusing the agent) or spend hours supervising what should be autonomous work (defeating the purpose).

**AFK fills this gap.** It is the build system for overnight AI coding — just as Make/Bazel orchestrate compilers deterministically, AFK orchestrates coding CLIs with state machines, worktree isolation, and 8-hour reliability guarantees across your entire project portfolio.

## Solution

AFK is a **globally installed daemon and CLI** that orchestrates autonomous coding agents across multiple repositories. It accepts work through multiple surfaces (CLI, TUI, Telegram, Linear), decomposes it into dependency-ordered tasks, researches unknowns, and executes implementation using a deterministic state machine pipeline — producing clean, mergeable git branches.

**Core interaction — the handoff:**
1. User provides a document (PRD, spec, bug report) via any intake surface
2. AFK routes it to the correct repo (or scaffolds a new one)
3. **INTAKE** workflow decomposes the document into a phased plan with dependency-ordered tasks
4. **RESEARCH** workflows investigate flagged unknowns in parallel
5. **AMEND** workflow adjusts the plan based on research findings
6. **IMPLEMENTATION** workflows execute tasks per project using configurable step sequences
7. Each project produces a clean, independently mergeable git branch

The daemon runs persistently, managing work across all registered repos. Multiple sessions can run in parallel across different repos. Everything is traceable: every task, step, decision, token spent, and commit is recorded in a relational database with full lineage.

**Architecture type:** Meta-harness (H.1-B per harness taxonomy). AFK does not call model APIs directly — it spawns first-party CLI tools (Claude Code, Codex CLI, Gemini CLI, Copilot CLI) as sub-processes, each retaining their full tool-use capabilities. AFK controls the orchestration; agents handle the creative work.

## User Stories

1. As a solo developer, I want to hand off a PRD to AFK before going to sleep, so that I wake up to implemented, committed code on clean branches ready for review.

2. As a developer, I want to run `afk init` in my repo and `afk start` with pre-written specs, so that AFK executes my task queue without me decomposing the PRD myself.

3. As a developer, I want to run `afk handoff <prd.md>`, so that AFK automatically decomposes my PRD into tasks, researches unknowns, and executes the full implementation pipeline.

4. As a developer, I want AFK to produce one git branch per project with atomic commits per task, so that I can review, cherry-pick, or discard work at task granularity.

5. As a developer, I want to see real-time progress in a k9s-style TUI dashboard, so that I can monitor what AFK is doing without reading raw logs.

6. As a developer, I want AFK to automatically detect when a plan is wrong mid-execution and revert tainted commits before re-planning, so that bad assumptions don't compound into unfixable code.

7. As a developer, I want AFK to failover to a different provider when one hits quota limits, so that overnight runs don't stall waiting for rate limits to reset.

8. As a developer, I want to use consensus mode for analysis steps (multiple models analyze independently, then a synthesis agent merges findings), so that implementation benefits from multiple perspectives.

9. As a developer managing multiple repos, I want a single AFK daemon tracking all my projects, so that I can dispatch work to any repo from anywhere and see cross-repo status.

10. As a developer, I want AFK to survive agent crashes and auto-restart from the last checkpoint, so that a single agent failure doesn't lose hours of progress.

11. As a developer, I want AFK to survive daemon crashes and resume all in-flight work from SQLite state on restart, so that even a machine reboot doesn't lose session state.

12. As a developer, I want to define custom workflow step sequences per repo (e.g., a bugfix workflow that skips ANALYZE and TEST_PLAN), so that different types of work use appropriate processes.

13. As a developer, I want `afk status` to show me the state of all active sessions across all repos, so that I have a single pane of glass for all AFK-managed work.

14. As a developer, I want to send a Telegram message with a PRD and repo name, so that I can dispatch work to AFK from my phone without touching a terminal.

15. As a developer, I want AFK to track every decision made during execution in a queryable log, so that I can understand why any particular implementation choice was made.

16. As a developer, I want per-step token accounting, so that I can see exactly where my API budget is going and optimize workflow configurations.

17. As a developer, I want AFK to enforce security policies (file access, allowed tools, network restrictions) at four layers (global/repo/session/step) with deny-wins logic, so that agents can't access what isn't explicitly allowed.

18. As a developer, I want to configure autonomy levels (full/supervised/assisted) per workflow and switch mid-session, so that I can run trusted repos fully autonomous while supervising new ones.

19. As a developer, I want AFK's RESEARCH workflow to investigate flagged unknowns using parallel sub-agents with web search, so that specs are informed by real research rather than model hallucinations.

20. As a developer, I want the desktop app (Tauri) to show multiple repos in tabs with live dashboards, decision graphs, and review interfaces, so that I have a native app experience for managing all AFK work.

21. As a developer, I want `afk research <question>` to run a standalone deep research workflow and produce a structured report, so that I can use AFK's research capability independently of implementation.

22. As a developer, I want AFK to run an exploration mode when task queues empty (bug finding, improvement proposals with clearly tagged exploratory commits), so that idle compute time produces value.

23. As a developer, I want heartbeat supervision to detect stuck agents (not just crashed ones), so that an agent spinning in an infinite loop gets killed and restarted rather than burning tokens.

24. As a developer, I want resume tokens for supervised mode — when AFK pauses at a gate, I get a token I can approve or deny from any surface (CLI, Telegram, TUI), so that I don't need to be at my terminal to unblock work.

25. As a developer, I want Linear integration that auto-picks up tickets tagged `afk-ready` and syncs status bidirectionally, so that my project management tool stays in sync with AFK execution.

26. As a developer, I want every task to produce a rich commit message with task metadata (task ID, project, step sequence, provider used, tokens spent), so that `git log` tells the full story of how code was produced.

27. As a developer, I want to be able to revert to any specific point in a project's plan and restart execution from there, so that I can course-correct at any granularity.

28. As a developer, I want AFK to inject relevant code context via a tree-sitter repo map ranked by relevance, so that agents start each step with structural understanding of the codebase.

29. As a developer, I want context budget management that prevents token limit errors by truncating/prioritizing context before spawning agents, so that steps never fail due to context overflow.

30. As a developer, I want failure gates — past errors that modify supervisor behavior (e.g., "never trust test X") — so that AFK learns from its mistakes within and across sessions.

## Implementation Decisions

### Harness Taxonomy Alignment

AFK's design maps to the following harness taxonomy positions. This serves as a completeness checklist — every concept below is addressed in the architecture.

| Module | Key Positions |
|--------|--------------|
| **Archetype** | H.1-B: Meta-harness — spawns CLI tools, delegates agent loop |
| **M0 Model Interface** | Transport: Pipe spawn (D). Auth: Credential inheritance (C). Scope: Multi-vendor heterogeneous (D). Selection: Capability tiers (C). Streaming: NDJSON (C). Failover: Ordered list (C). Caching: Prompt caching via vendor support (B) — Anthropic and Google both support prefix caching natively; AFK assembles context with stable prefixes to maximize cache hits. Response/tool caching deferred. Sub-harness: Multiple CLIs with adapters (C) |
| **M1 Agent Loop** | Ownership: Fully delegated (B). Observation: File system polling + NDJSON events (E+C). Termination: Process exit + completion file (B+D). Context rot: Loop-and-reset per step (D) + external context offloading via memory files (F) — each step is a fresh spawn; accumulated knowledge persists in files (specs, decisions.jsonl, memory) that subsequent steps re-read. Errors: Typed routing (D). Code modification: Delegated (F). Output: File convention + exit code (E+F) |
| **M2 Session Mgmt** | Identity: Persistent UUID + sub-harness ID (C+D). Records: Structured event log (C). Relations: Full lineage — project→task→session→invocation (D). Resume: Hybrid (D). Backend: SQLite (C) |
| **M3 Context** | Assembly: Dynamic (C). Repo awareness: Symbol index via tree-sitter (D). Task spec: Typed schema (C). Instructions: Canonical→compiled to vendor files (D). Budget: Layered (C). Mid-session: Interrupt+respawn (G) |
| **M4 Workflow** | Steps: State machine (D). Definition: User-customizable YAML (D). Loops: Budget-enforced with stuck detection (D). Pipeline: Dynamic routing (D). I/O: Typed schema validation (C). Data: File-first (B) |
| **M5 Supervision** | Spawn: Long-lived with restart (C). Stall: Heartbeat staleness (D). Recovery: Restart with modified context (C). Budget: Configurable per workflow/step (C). Progress: Git activity + heartbeat (D) |
| **M6 Workspace** | Isolation: Git worktree (B). Lifecycle: Auto-managed (C). Orphan: Auto cleanup (C). Checkpoint: Commit before risky step (C). Revert: Revert+rebuild (D). Delivery: PR creation (C) |
| **M7 Memory** | Working: Assembled at spawn (C). Store: Structured markdown + SQLite (C+D). Decisions: Indexed store (C). Learning: Automated post-session (C). Retrieval: Full injection core + keyword search (B+C). Sharing: SQLite transactions (C) |
| **M8 Security** | Hooks: Pre+post (D). Policy: Full allow/deny/modify (D). Layers: Global→repo→session→step (C). Sandbox: File scope limits (B). Audit: Structured tool call log (C). Secrets: Env injection (B) |
| **M9 Planning** | Decomposition: Automated PRD parsing (C). Graph: Dependency DAG (C). Format: Typed schema (C). Invalidation: Automated detection (C). Replan: Research-chained (D). Budget: Configurable (C) |
| **M10 Multi-Agent** | Parallelism: Independent tasks + consensus (D). Coordination: SQLite shared state (C). Consensus: Synthesis agent (D). Merge: Manual initially (A) — parallel projects produce independent branches; user merges/cherry-picks manually. Automated merge queue (D) is a future consideration once multi-project is stable. Protocol: Custom file protocol (A) — AFK uses its own file convention (step_input/step_complete) rather than MCP or A2A because agents are sub-processes, not networked peers. Standard protocols add complexity without benefit for local process spawning. Revisit if AFK ever supports remote agent execution. |
| **M11 Daemon** | Process: Background daemon (C). Scope: Multi-repo (B). Triggers: Multiple combined (E). Recovery: Full state machine snapshot restore (D) |
| **M12 Human Interface** | Autonomy: Configurable gates (D). Notification: External channel (D). Surfaces: CLI + TUI + Desktop (G). Switching: Mid-session (C). Primary surface: Multiple (G). Deployment: Global CLI binary (A) + Desktop app (C). Visibility: Live TUI (C). Protocol: REST API / HTTP+SSE (E) — ACP not adopted because AFK is not an IDE extension; HTTP+SSE is simpler and sufficient for local daemon↔client communication. Mid-session steering: Interrupt+respawn (G) — to steer a running task, supervisor kills current agent, amends context (updated spec, additional constraints), and relaunches. No stdin injection or CLAUDE.md mutation because each step is a fresh spawn by design. |
| **M13 Observability** | Tokens: Per-step granular (C). Metrics: Structured log events (B) — Prometheus endpoint deferred; structured JSON logs are sufficient for a local daemon and can be consumed by external tooling if needed. Traces: Pipeline-level (C) + cross-agent correlation for consensus mode — parallel consensus agents share parent span ID for correlation. Status: Live + push-based (C+D) |
| **M14 Extensibility** | Surface: Workflow composition with built-in steps — users cannot add new step types but can compose custom workflows from the built-in step catalog and configure per-step parameters (tier, consensus, limits). Closer to (B) than (C). Format: Config-declared YAML (B). Isolation: N/A — no loadable code extensions; each agent runs as a separate process naturally. Lifecycle: Per-execution reload (B→C hybrid) — YAML workflows are loaded fresh per execution, so edits take effect without daemon restart. |
| **M15 Verification** | Method: Combined — tests + lint + self-review (G). Gates: Multiple points (F). Failure: Retry + replan + escalate (B+C+D). Budget: Configurable per step (C) |

### Architecture Modules

The system is composed of 17 modules organized into 4 layers:

**Layer 1 — Infrastructure**

1. **Daemon (M11)** — Global Bun process running as HTTP+SSE server on localhost. Manages repo registry, dispatches work, tracks cross-repo state. Started explicitly via `afk daemon start`. Managed by launchd on macOS for auto-restart on crash. Desktop app launch starts the daemon automatically. All clients (CLI, TUI, desktop app) connect via HTTP. SSE provides real-time event streaming to all connected clients.

2. **Session Store (M2)** — SQLite database (WAL mode) with full relational hierarchy: Session → Pipeline → Project → Task → Step → Invocation. Each record tracks: provider, model, tokens (input/output/cached/thinking), duration, status, git commit SHA, decision references. Event stream table for ordered append-only audit log. Separate databases: global (`~/.afk/afk.db`) for repo registry and cross-repo state, per-repo (`<repo>/afk/sessions.db`) for execution state.

3. **Observability (M13)** — Per-step token/cost accounting. Structured JSON event logging. Pipeline-level trace correlation (all events in a pipeline share a trace ID, all events in a step share a span ID). Live status queryable via HTTP endpoint. Push-based status updates to external channels (Telegram, future Slack).

**Layer 2 — Orchestration**

4. **Workflow Engine (M4)** — XState v5 state machines at two levels: pipeline-level (INTAKE → RESEARCH → AMEND → IMPLEMENTATION) and task-level (PREP → IMPLEMENT → REVIEW → COMMIT). Workflows defined in YAML, loaded and validated at execution time. Built-in step types are predefined; users compose custom workflows from the built-in step catalog. Phase-based iteration limits: main phase budget (PREP + IMPLEMENT attempts), review phase budget (REVIEW rounds), validation phase budget (VALIDATE retries). Stuck detection via diff comparison between iterations.

5. **Provider Layer (M0)** — CLI abstraction for Claude Code, Codex CLI, Gemini CLI, Copilot CLI. Per-provider invocation builders with appropriate flags. Model catalog mapping neutral tiers (frontier/standard/fast) to concrete models. Provider detection (which binaries are available). Quota detection from CLI output patterns. Ordered failover: on quota/error, try next provider in preference list. Credential inheritance — each CLI finds its own stored credentials.

6. **Executor / Process Supervisor (M1, M5)** — Spawns agent CLI processes via Bun.spawn(). NDJSON event stream parsing for real-time monitoring. Heartbeat supervision: agent writes heartbeat file every N seconds proving progress; supervisor detects staleness and kills/restarts stuck agents. Configurable restart budget per workflow/step. Typed error classification: transient (retry), permanent (fail), plan-invalid (replan), needs-input (escalate). Timeout enforcement (default 1 hour per step, configurable). Output extraction via file convention (agent writes to known paths).

7. **Git Manager (M6)** — Worktree lifecycle: create before project, destroy after delivery. Branch management: one branch per project, atomic commits per task. Orphan worktree detection and cleanup on daemon start. Checkpoint commits before risky steps. Revert operations: `git revert` for tainted commits (preserves history, no `git reset`). Rich commit messages with task metadata. Delivery: branches ready for PR creation or cherry-pick.

**Layer 3 — Intelligence**

8. **Intake Pipeline (M9)** — Input classification (task/bug/PRD/research/vague). PRD decomposition into dependency-ordered project/task DAG. Spec generation per task. Research flag detection: identifies areas needing deeper investigation (technology choices, integration unknowns, multiple viable approaches). Direct spec creation for simple tasks (bypass research).

9. **Research Pipeline (M9, M10)** — PLAN: decompose research question into sub-question DAG. INVESTIGATE: parallel sub-agents per independent sub-question, each running search-evaluate-refine loops with web search tools. SYNTHESIZE: merge findings, identify themes, flag remaining gaps. GAP-FILL: optional targeted follow-up (iteration-capped). PRODUCE: structured research report. Effort scaling via configurable sub-question budget and per-agent tool call budget.

10. **Re-planner (M9)** — Detects plan invalidation signals (agent signal, review scope creep, dependency contradiction, repeated failure). Pauses affected project. Re-plan agent receives: original PRD, current plan with completion status, evidence of breakage, git log, repo map. Outputs revert instructions (which commits are tainted). Supervisor executes `git revert` per tainted task. Reconciliation: reverted tasks re-queued with updated specs, new tasks added. Can chain to RESEARCH → AMEND if new unknowns emerge. Budget: max N re-plans per session (configurable, default 3).

11. **Consensus Engine (M10)** — Slot-based fan-out for consensus-enabled steps (e.g., ANALYZE). Supervisor spawns N agents in parallel with per-slot provider assignment. Timeout per slot. Synthesis agent (frontier tier) merges all N analyses into unified, enriched output. Implementation agent receives benefit of multiple perspectives. Configurable: slots count, preferred providers, synthesis tier, timeout.

12. **Memory & Context (M3, M7)** — Layer 1: Always-loaded context (MEMORY.md, active-context.md, ROUTER.md) injected into every prompt. Layer 2: Tree-sitter repo map ported from Aider — structural code index with graph-ranked relevance, regenerated on commits. Layer 3: Failure gates — past errors that modify supervisor behavior (max 20, stored globally). Context budget management: pre-step token estimation, truncate/prioritize when over budget, per-model budget adjustment. Dynamic context assembly at spawn time from multiple sources.

13. **Security & Policy (M8)** — Hook-based policy engine following Claude Code's PreToolUse pattern. Every tool call intercepted before execution. Unified policy evaluation across four layers: global (`~/.afk/policy.yaml`) → repo (`<repo>/afk/policy.yaml`) → session (runtime) → step (workflow definition). Deny always wins. PolicyStatement schema: effect (allow/deny), resources (glob patterns), actions (read/write/bash/git), conditions. Structured audit log of every policy decision. Secret management: scoped env var injection at spawn time.

**Layer 4 — Interface**

14. **CLI Client (M12)** — Thin HTTP client sending commands to daemon. Commands: `afk daemon start|stop|status`, `afk init`, `afk start`, `afk handoff <prd>`, `afk research <question>`, `afk status [--repo <name>]`, `afk pause|resume`, `afk approve|deny <token>`, `afk new <name>`. SSE subscription for `afk status --follow`. Outputs structured text for scriptability.

15. **TUI Dashboard (M12)** — OpenTUI-based k9s-style terminal interface. Multi-panel layout: repo list, active sessions, task progress, live logs, token counters. Keyboard navigation. Real-time updates via SSE from daemon. Drill-down: repo → session → pipeline → project → task → step. Searchable decision log viewer.

16. **Desktop App (M12)** — Tauri v2 with React + Tailwind frontend. Connects to daemon via HTTP+SSE (same as CLI/TUI). Multi-repo tabs. Live dashboard with decision graph visualization. Review interface for approval gates. Session reports. Launches daemon on app start if not already running.

17. **Integrations (M11, M12)** — Telegram bot: dispatch work via `/handoff <repo> <prd>`, `/new <name> <prd>`, `/status`. Outbound notifications for gate hits, session completion, errors. Linear integration: poll for `afk-ready` tickets, bidirectional status sync, repo routing via project→alias mapping.

### Daemon Architecture

- **Process model:** Single Bun process. HTTP server (Bun.serve()) on localhost with REST endpoints for commands and SSE endpoints for event streaming. Spawns child processes per agent invocation.
- **Startup:** Explicit `afk daemon start` from CLI. Desktop app auto-starts on launch. launchd plist for auto-restart on crash (not auto-start on boot).
- **IPC:** HTTP + SSE on localhost (following OpenCode's pattern). REST for commands, SSE for real-time events. Both CLI and desktop app are thin clients connecting via HTTP.
- **State recovery:** On restart, daemon reconstructs in-flight state from SQLite. XState machine snapshots persisted per-step. Resumes all active sessions from last checkpoint.

### Workflow System

**Built-in step types (predefined, not user-extensible):**

| Step | Purpose | Tier |
|------|---------|------|
| PREP | Run tests, fix existing failures, establish baseline | standard |
| PICK | Select next task from queue based on dependencies | supervisor (no agent) |
| ANALYZE | Analyze task requirements, identify approach | frontier (consensus-capable) |
| TEST_PLAN | Write tests before implementation | standard |
| IMPLEMENT | Write code based on spec and analysis | frontier |
| CLEANUP | Remove dead code, fix obvious issues | fast |
| SIMPLIFY | Surface-level clarity improvements | fast |
| REVIEW | Review diff with persona-based criteria | frontier (consensus-capable) |
| VALIDATE | Supervisor runs tests/linter (no agent) | supervisor |
| COMMIT | Create atomic commit with rich metadata | supervisor |
| EXPLORE | Bug finding, improvement proposals when idle | standard |

**Built-in workflow definitions:**

```
Default task workflow:
  PREP → PICK → ANALYZE → TEST_PLAN → IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW → VALIDATE → COMMIT
  Review loop: REVIEW(needs-changes) → IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW

Bugfix task workflow:
  PREP → IMPLEMENT → REVIEW → VALIDATE → COMMIT

Pipeline workflows:
  handoff:  INTAKE → RESEARCH → AMEND → IMPLEMENTATION
  start:    IMPLEMENTATION
  research: RESEARCH → PRODUCE
```

**Phase-based iteration limits (configurable per workflow):**
- Main phase: max N IMPLEMENT attempts (default 3)
- Review phase: max N REVIEW rounds (default 5)
- Validation phase: max N VALIDATE retries (default 3)
- Global task budget: max total agent invocations per task (default 20)
- Re-plan budget: max N per session (default 3)

**Custom workflows:** Users create YAML files in `<repo>/afk/workflows/` composing built-in steps in custom sequences with per-step configuration (tier override, consensus enable/disable, iteration limits). Validated before execution.

### Entity Hierarchy

```
AFK Global (daemon process — ~/.afk/)
  └── Repo (registered git repository)
       └── Session (one handoff or start invocation)
            └── Pipeline (chain of workflows: INTAKE → RESEARCH → AMEND → IMPLEMENTATION)
                 └── Project (one worktree, one branch)
                      └── Task (one unit of work, one commit)
                           └── Step (one workflow step execution)
                                └── Invocation (one agent CLI spawn)
```

Every level is a row in the database with full parent references, timestamps, status, and token accounting.

### Error Classification & Recovery

| Error Class | Examples | Recovery |
|-------------|----------|----------|
| Transient | Network timeout, provider 500, OOM | Retry with backoff (up to restart budget) |
| Quota | Rate limit, token budget exceeded | Failover to next provider |
| Permanent | Invalid spec, impossible task | Mark failed, escalate to human |
| Plan-invalid | Spec assumptions wrong, scope creep | Pause project, invoke REPLAN workflow |
| Needs-input | Ambiguous requirement, missing credential | Pause, notify human, await resume token |
| Stuck | No progress (heartbeat stale, diff identical) | Kill agent, restart with modified context |

### File Protocol

The agent I/O protocol uses the filesystem as the communication channel:
- Supervisor writes `step_input.json` (step name, task context, memory, repo map)
- Agent reads input, performs work, writes `step_complete.json` (status, output, decisions)
- Decisions appended to `decisions.jsonl` (append-only, queryable by step/task/project)
- `step_complete.json` references decision IDs (single source of truth in JSONL)
- All files validated against Zod schemas
- Atomic writes prevent corruption during concurrent access

### Configuration

- **Global config:** `~/.afk/config.yaml` — provider preferences, model catalog overrides, default autonomy mode, Telegram token, Linear API key
- **Per-repo config:** `<repo>/afk/config.yaml` — workflow overrides, policy, provider preferences, custom workflows
- **Session config:** Runtime overrides via CLI flags or API parameters
- **Config loading:** c12 library merges global → repo → session layers
- **Workflow YAML:** `<repo>/afk/workflows/` — custom workflow definitions using built-in steps

## Testing Decisions

**Philosophy:** Test external behavior, not implementation details. A good test for AFK verifies that given specific inputs (specs, config, agent output), the system produces correct outputs (commits, status records, state transitions) — not that internal functions were called in a specific order.

**Unit tests (bun:test with mocks/fakes):**
- **Workflow Engine** — State machine transitions, phase-based limit enforcement, stuck detection, YAML loading and validation
- **Provider Layer** — Invocation building per provider, model tier resolution, quota pattern detection, failover logic
- **Executor** — Output parsing, token extraction, heartbeat staleness detection, error classification
- **Session Store** — Full CRUD, relational integrity (session→pipeline→project→task→step→invocation), event stream ordering
- **File Protocol** — Schema validation, atomic writes, task parsing round-trips
- **Git Manager** — Worktree lifecycle, commit metadata, revert operations
- **Re-planner** — Revert instruction generation, task reconciliation logic
- **Security** — Policy evaluation across 4 layers, deny-wins logic, glob pattern matching

**Integration tests (real agent CLI):**
- **End-to-end single task:** Spawn real Claude Code in headless mode, execute one spec, verify commit produced with correct metadata
- **Crash recovery:** Kill agent mid-step, verify supervisor detects and restarts, verify work resumes from checkpoint
- **Daemon lifecycle:** Start daemon, send commands via HTTP, verify SSE events, stop daemon, restart, verify state recovery from SQLite
- **Provider failover:** Simulate quota hit, verify automatic switch to next provider
- **Workflow execution:** Run full default workflow (PREP→IMPLEMENT→REVIEW→VALIDATE→COMMIT), verify all steps execute and produce expected artifacts

**Prior art:** Existing test suite (108 passing tests) in `tests/` directory. Uses `fake-agent.sh` for mocking agent CLI output. Pattern: create temp directory, set up fixtures, run function under test, assert outputs, clean up.

## Tracer Bullet Delivery Plan

Each tracer bullet delivers a thin but complete vertical slice through the entire system — from daemon to CLI to workflow to agent to git to database to output. Every TB produces a working, demonstrable capability.

### TB1 — Single Task End-to-End

**Capability:** Execute one pre-written task spec against one repo using Claude Code, producing a committed result trackable in the database.

**Touches:** Daemon (HTTP server) → CLI (`afk daemon start`, `afk init`, `afk start`, `afk status`) → Workflow Engine (minimal task machine: PREP → IMPLEMENT → VALIDATE → COMMIT) → Provider (Claude Code only) → Executor (spawn, monitor, parse output) → Git Manager (one worktree, one branch, one commit) → Session Store (full hierarchy persisted) → File Protocol (step_input/step_complete) → Observability (per-step token tracking, basic event log)

**Success criteria:**
- `afk daemon start` launches HTTP+SSE server
- `afk init` registers repo in global DB
- `afk start` with one spec → daemon picks up, executes PREP → IMPLEMENT → VALIDATE → COMMIT
- `afk status` shows real-time progress via SSE
- Produces one atomic commit with rich metadata
- Session/pipeline/project/task/step/invocation all recorded in SQLite
- Survives agent crash (heartbeat detection, auto-restart)
- Survives daemon restart (state recovery from SQLite)

### TB2 — Multi-Task Pipeline + Review Loop

**Capability:** Execute multiple dependent tasks with the full default workflow including review loops and phase-based iteration limits.

**Touches:** Adds to TB1: task dependency resolution (PICK step), full step sequence (ANALYZE → TEST_PLAN → IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW), review loop with diff-based stuck detection, phase-based budgets, custom workflow YAML loading.

**Success criteria:**
- Multiple tasks execute in dependency order
- Review loop triggers IMPLEMENT on needs-changes
- Phase-based limits enforced (main, review, validation budgets)
- Stuck detection kills non-progressing review loops
- Custom workflow YAML can override default step sequence
- All iterations tracked with full lineage in DB

### TB3 — TUI Dashboard

**Capability:** k9s-style terminal dashboard showing live session state, task progress, logs, and token accounting.

**Touches:** Adds to TB1-2: OpenTUI-based TUI connecting to daemon via SSE, multi-panel layout, keyboard navigation, drill-down views.

**Success criteria:**
- TUI launches and connects to running daemon
- Shows repo list, active sessions, task progress, live logs
- Drill-down: repo → session → project → task → step
- Token counters update in real-time
- Keyboard navigation (vim-style)
- Searchable decision log

### TB4 — Intake + Research Pipeline

**Capability:** `afk handoff <prd.md>` runs full pipeline: decompose PRD, research unknowns, amend plan, execute implementation.

**Touches:** Adds to TB1-3: INTAKE workflow (classification, decomposition, spec generation, research flagging), RESEARCH workflow (sub-question DAG, parallel investigation, synthesis, report production), AMEND workflow (plan adjustment), pipeline-level XState machines with state transfer between workflows.

**Success criteria:**
- `afk handoff <prd.md>` accepted, routed to current repo
- INTAKE decomposes PRD into project/task DAG with specs
- Research flags detected, RESEARCH workflow triggered for flagged areas
- RESEARCH produces structured reports using web search
- AMEND adjusts plan/specs based on research findings
- IMPLEMENTATION executes amended plan
- Full pipeline traceable in DB and TUI

### TB5 — Multi-Provider + Consensus

**Capability:** Execute work with any available provider, automatic failover, and consensus-enriched analysis.

**Touches:** Adds to TB1-4: Codex adapter, Gemini adapter, Copilot adapter (if mature), quota detection patterns, ordered failover logic, consensus fan-out for ANALYZE step, synthesis agent.

**Success criteria:**
- Same task executes with different providers (configurable preference)
- Quota detection triggers automatic failover to next provider
- ANALYZE step runs in consensus mode (N parallel agents)
- Synthesis agent produces enriched unified analysis
- IMPLEMENT receives consensus-enriched context
- Provider used tracked per invocation in DB

### TB6 — Re-planning + Revert

**Capability:** Detect plan invalidation mid-execution, revert tainted commits, re-plan with accumulated context, optionally chain to research.

**Touches:** Adds to TB1-5: plan invalidation signal detection, REPLAN workflow, revert logic (`git revert` per tainted task), task reconciliation, research-chained replan, replan budget enforcement.

**Success criteria:**
- Agent can signal plan invalidation via step output
- Supervisor pauses project, invokes REPLAN
- Re-planner identifies tainted commits
- `git revert` applied (history preserved)
- Plan reconciliation: reverted tasks re-queued, new tasks added
- Re-plan can chain to RESEARCH if new unknowns
- Replan budget enforced (max N per session)
- Full revert/replan history in DB

### TB7 — Multi-Project Parallelism

**Capability:** Multiple projects from a single session run in parallel on separate worktrees.

**Touches:** Adds to TB1-6: parallel project execution, per-project worktrees and branches, independent task queues, shared context (specs, memory, research reports).

**Success criteria:**
- Single `afk handoff` produces multiple projects (from INTAKE decomposition)
- Each project gets own worktree and branch
- Projects execute in parallel
- Each project produces independently mergeable branch
- No interference between parallel projects
- Shared research/memory accessible to all projects

### TB8 — Memory + Context Engineering

**Capability:** Agents receive relevant code context via repo map, memory layers inject appropriate knowledge, context budget prevents overflow.

**Touches:** Adds to TB1-7: tree-sitter repo map (ported from Aider), graph-ranked relevance, memory layers (always-loaded + repo map + failure gates), context budget estimation and enforcement, repo map regeneration on commits.

**Success criteria:**
- Tree-sitter parses codebase into structural index
- Repo map injected into step prompts ranked by relevance
- Context budget calculated per step, truncation applied when over
- Failure gates modify supervisor behavior (skip flaky tests, etc.)
- Repo map regenerates automatically after commits
- Context budget respected (no token limit errors)

### TB9 — Autonomy + Human Gates

**Capability:** Variable autonomy levels with pause/resume via resume tokens, configurable per workflow/step.

**Touches:** Adds to TB1-8: autonomy mode configuration (full/supervised/assisted), per-step gate configuration in workflow YAML, checkpoint serialization on gate hit, resume token generation and validation, approve/deny from any surface (CLI, TUI, Telegram).

**Success criteria:**
- Supervised mode pauses at configured gates
- Resume token generated, displayed in TUI and sent to Telegram
- `afk approve <token>` resumes from exact checkpoint
- `afk deny <token>` cancels with reason
- Autonomy switchable mid-session per project
- Full gate history in DB

### TB10 — Multi-Repo + Integrations

**Capability:** Global daemon managing multiple repos simultaneously, Telegram dispatch, Linear integration.

**Touches:** Adds to TB1-9: multi-repo registry, routing (match incoming work to registered repo by name/alias), Telegram bot (dispatch, status, notifications), Linear polling (afk-ready tickets, bidirectional sync), repo scaffolding (`afk new`).

**Success criteria:**
- Multiple repos registered and managed simultaneously
- `afk status` shows cross-repo overview
- Telegram: `/handoff project-alpha <prd>` dispatches to correct repo
- Linear: tickets tagged `afk-ready` auto-picked up
- Bidirectional Linear status sync
- `afk new <name>` scaffolds new repo and registers it
- Notifications sent on gate hit, completion, error

### TB11 — Security + Polish

**Capability:** Full security policy enforcement, exploration mode, CLI polish.

**Touches:** Adds to TB1-10: hook-based policy engine, 4-layer policy evaluation, PreToolUse interception, deny-wins logic, scoped secret injection, structured audit log, exploration mode (idle compute), CLI polish (all commands, error handling, help text).

**Success criteria:**
- Policy evaluated on every tool call (pre-execution)
- Deny at any layer blocks action
- Audit log records every policy decision
- Secrets injected per-step via scoped env vars
- Exploration mode triggers on empty queue, produces tagged commits
- All CLI commands implemented with proper error handling

### TB12 — Desktop App

**Capability:** Native macOS app with multi-repo tabs, live dashboards, review interface.

**Touches:** Adds to TB1-11: Tauri v2 app, React + Tailwind frontend, HTTP+SSE connection to daemon, multi-repo tabs, decision graph visualization, review interface for gates, session reports.

**Success criteria:**
- Desktop app launches and starts daemon if needed
- Multiple repos shown in tabs
- Live dashboard updates via SSE
- Decision graph visualization
- Review interface for approval gates
- Session reports exportable

## Out of Scope

- **IDE integration** (VS Code, Cursor, JetBrains extensions) — AFK is a standalone tool, not an editor plugin
- **Cloud deployment** — macOS-only tool running locally
- **Direct API calls** — AFK always spawns CLI binaries, never calls model APIs directly
- **Custom step types** — users compose workflows from built-in steps; adding new step types requires code changes
- **Real-time chat** — AFK is non-conversational by design; interaction is handoff + observe + review
- **Distributed execution** — single machine (multiple processes, but one physical host)
- **Windows/Linux support** — macOS-first (Linux plausible later due to Bun portability, but not a goal)
- **Agent framework internals** — AFK does not modify or extend the sub-harness CLIs themselves
- **Code plugins / runtime extensions** — extensibility is via YAML workflow configuration, not loadable code modules

## Further Notes

### Key Architectural Bets

1. **Meta-harness over API harness:** AFK spawns CLI tools rather than calling APIs directly. This means AFK gets all tool-use capabilities (file editing, bash, git) for free, but is coupled to CLI binary interfaces. The bet is that CLI interfaces are stable enough and the tooling benefits outweigh the coupling cost.

2. **XState for deterministic orchestration:** Every flow control decision is in a state machine, never delegated to the LLM. This sacrifices flexibility (the LLM can't dynamically alter the workflow) in favor of reliability and debuggability. The bet is that overnight reliability matters more than dynamic adaptation.

3. **Git worktrees for isolation:** One project = one worktree = one branch. This is simpler than containers but limits isolation to the filesystem level (shared system, shared network). The bet is that filesystem isolation is sufficient for code generation tasks.

4. **HTTP+SSE for IPC:** Following OpenCode's pattern. Simpler than gRPC, works natively with Bun.serve(), and enables the same protocol for CLI, TUI, and desktop app. The bet is that the simplicity outweighs gRPC's type safety and streaming advantages.

5. **Loop-and-reset over long-running sessions:** Each step is a fresh agent spawn with assembled context, using git as memory between steps. This sacrifices continuity (agent doesn't remember its own prior steps) in favor of context freshness and crash recovery. The bet is that well-assembled context is better than a long, rotting context window.

### Unresolved Design Questions

These are acknowledged unknowns to be resolved during implementation:

1. **Repo map value vs. cost:** Does tree-sitter repo map provide enough value to justify the implementation effort? (Validate in TB8)
2. **Research depth calibration:** How does INTAKE determine which areas need deep research vs. quick lookup vs. none? Needs experimentation with real PRDs. (Validate in TB4)
3. **Pipeline state transfer format:** How much context from upstream workflows should downstream workflows receive? Full reports vs. summaries vs. decision entries only? Context budget implications. (Validate in TB4)
4. **Multi-session per repo conflicts:** When two PRDs target the same repo, how do concurrent sessions avoid stepping on each other? (Validate in TB10)
5. **Consensus synthesis quality:** Does the synthesis agent produce meaningfully better output than the best individual analysis? (Validate in TB5)
