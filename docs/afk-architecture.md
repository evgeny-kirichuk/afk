# AFK — Architecture & Implementation Guide

## Purpose

This document is the **source of truth** for AFK's architecture and phased implementation. It captures validated architectural decisions, defines clear implementation phases with dependencies, and flags unresolved questions that must be answered before coding begins.

**Not included here:** Specific file formats, detailed schemas, CLI command syntax, config YAML structures, or pseudo-code. Those emerge during implementation and belong in component-specific design docs.

---

## 1. Core Concepts

### 1.1 Mental Model

AFK is a **globally installed CLI and daemon** that orchestrates autonomous coding agents across multiple repositories. It runs as a single persistent process that manages work across all repos it knows about, watches intake surfaces (CLI, Telegram, Linear), and dispatches sessions to repos in parallel.

The primary interaction is the **handoff**: you provide a document (PRD, spec, research output) — via CLI, Telegram message, or Linear ticket — and AFK routes it to the right repo (or scaffolds a new one), then runs a **pipeline of chained workflows**. Each workflow is a self-contained blueprint for a specific activity (intake, deep research, planning, implementation, re-planning). The supervisor chains them, passing accumulated state between them:
1. **Route** — global daemon determines target repo (explicit name match, or scaffold new repo)
2. **Intake** workflow decomposes the PRD into a phased plan, flags areas needing research
3. **Deep research** workflows investigate flagged areas (parallel, multi-agent)
4. **Amend** workflow adjusts the plan, specs, and dependencies based on research findings
5. **Implementation** workflows execute tasks per project using configurable step sequences
6. Delivers clean, mergeable git branches

Multiple repos can have active sessions simultaneously. Multiple PRDs can target the same repo as separate sessions. Each repo's work is independently startable and stoppable.

**Key insight from research:** AFK occupies a genuine gap — no existing tool combines deterministic state machines, local CLI spawning, git worktree isolation, multi-repo management, and 8-hour overnight reliability. Positioning: "The build system for overnight AI coding — just as Make/Bazel orchestrate compilers deterministically, AFK orchestrates coding CLIs with state machines, worktree isolation, and 8-hour reliability guarantees across your entire project portfolio."

### 1.2 Entity Hierarchy

```
AFK Global (single daemon process — ~/.afk/)
  ├── Repo "project-alpha" (~/.afk/repos registry → /Users/me/code/project-alpha)
  │   ├── Session (afk handoff <prd>)
  │   │   └── Pipeline (INTAKE → RESEARCH → AMEND → IMPLEMENTATION)
  │   │       └── Project(s) (parallel, one per plan branch)
  │   │           └── Task queue (sequential, each runs a task-level workflow)
  │   └── Session (afk start — existing specs)
  │       └── Pipeline (IMPLEMENTATION only)
  │           └── Project(s) → Tasks
  │
  ├── Repo "project-beta" (independent, can run simultaneously)
  │   └── Session → Pipeline → Projects → Tasks
  │
  └── [New repo scaffolded from Telegram PRD]
      └── Session → Pipeline → Projects → Tasks
```

**AFK Global** = the daemon process. Manages the repo registry, watches intake surfaces (Telegram, Linear), routes incoming work to repos, tracks cross-repo state. Single process, always running (or started on demand). Per-repo work is independently startable/stoppable.

**Repo** = a git repository AFK is initialized in. Registered in the global database. Has its own `afk/` directory with workflows, policies, memory, and session state. Multiple repos can have active sessions in parallel.

**Session** = one logical unit of work within a repo (one `afk handoff` or `afk start` invocation). Multiple sessions per repo are possible (separate PRDs targeting the same codebase).

**Pipeline** = chain of workflows that achieve a session's goal. Different entry points use different pipelines: `afk handoff` runs the full chain (intake → research → amend → implementation), `afk start` with existing specs skips to implementation, `afk research` runs only the research workflow.

**Project** = unit of isolation and delivery within a session. Each project:
- Has its own git worktree (parallel execution without interference)
- Produces one branch (independently mergeable or discardable)
- Executes tasks sequentially (respecting dependency order)
- Has its own plan and runtime state

**Task** = single unit of work within a project. Each task runs a task-level workflow (step sequence) and produces one squashable commit.

Multiple projects run in parallel on the same repo. Each delivers a single branch you can merge, cherry-pick from, or discard entirely.

### 1.3 Foundational Principles

**Deterministic orchestration, creative execution**
- Global daemon dispatches work to repos; per-repo supervisors control execution
- Supervisor controls loop (step transitions, review counting, phase changes, re-planning) in code
- Agent handles creative work within each step
- **Never delegate orchestration to LLM via markdown instructions** — every flow control decision delegated to the model is a failure mode

**File-first + SQLite hybrid**
- **Files**: Agent protocol (agents read/write markdown/JSON/YAML natively). Human-readable, debuggable with `cat`, archive = move directory
- **SQLite**: Supervisor's operational state (session tracking, project→task→worktree relationships, event streams, queries). The supervisor queries internally; agents never touch it
- **Boundary**: Files are what agents see; SQLite is what the supervisor queries

**Workflow-first architecture**
- Every activity follows a named **workflow** — typed sequence of steps with transitions, conditions, consensus config
- Workflows operate at two levels: **pipeline-level** (intake, research, amend, re-plan) and **task-level** (implementation step sequences like PREP → IMPLEMENT → REVIEW → COMMIT)
- The overnight pipeline is itself a chain of workflows — each workflow's output becomes input context for downstream workflows
- Custom workflows are first-class at both levels (bugfix task workflow, domain-specific research workflow, etc.)
- Workflows are YAML definitions, not scattered in code or prompts
- Re-planning is a workflow, not a special case — it can itself trigger research workflows if new unknowns emerge

**Project isolation via git worktrees**
- 1 project = 1 worktree = 1 branch = N sequential commits
- Each task = one squashable commit (atomic review unit)
- Multiple PRDs targeting same repo → isolated worktrees and branches
- Cherry-pick the commits you want, drop the rest

**Consensus for understanding, single agent for execution**
- Multiple perspectives improve planning and analysis (catch different edge cases)
- Consensus mode: multiple models analyze independently → synthesis agent merges findings
- Implementation uses one capable model with benefit of consensus-enriched plan
- Philosophy: consensus for understanding the problem, capable single agent for solving it

**Adaptive re-planning with revert capability**
- When mid-execution evidence proves plan is wrong → supervisor invokes REPLAN workflow with accumulated context
- REPLAN can chain to RESEARCH → AMEND workflows if new unknowns emerge
- **Critical capability:** Re-planner can instruct supervisor to **revert** last N commits/tasks
- Resets project to known-good state before continuing in new direction
- Building fixes on wrong assumptions creates compounding errors; revert-and-rebuild is cleaner

**Provider-neutral CLI routing**
- AFK spawns local CLI binaries (`claude`, `codex`, `gemini`, `copilot`) — doesn't call APIs directly
- Model catalog maps neutral tiers (frontier/standard/fast) to concrete models
- When provider hits quota or fails → automatic failover to next provider
- File protocol doesn't care which CLI produced the commit

**Security by default-deny**
- AWS-style unified policy: deny always wins
- Policies stack across four layers (global → repo → session → step)
- Same schema everywhere
- Agents can only access what is explicitly allowed

**Heartbeat supervision**
- Agents write heartbeat files proving progress
- Supervisor watches for stale heartbeats
- Stale heartbeat = dead/stuck agent = automatic restart from last checkpoint
- Running process isn't useful if it's stuck — heartbeats prove *progress*

**Variable autonomy modes**
- Full autonomy: Run overnight unattended, no human gates
- Supervised: Pause at key decision points for review/approval
- Assisted: Human approves every major step (new/sensitive repos)
- Switchable mid-session per project

---

## 2. Architecture Overview

### 2.1 Tech Stack (from Architecture Research)

**Runtime:** Bun (fast startup, native FS, superior process APIs, single binary compilation)

**Build-vs-Adopt Matrix (validated from research):**

| Component | Decision | Solution | Rationale |
|---|---|---|---|
| **Workflow state machine** | Adopt | XState v5 | MIT, TS-native, zero deps, JSON-serializable |
| **Persistence for state machine** | Build | Custom SQLite checkpointing | ~2-3 days, required for XState persistence |
| **Database** | Adopt | `bun:sqlite` + Drizzle ORM | 3-6x faster than better-sqlite3, zero npm deps |
| **Process spawning** | Adopt | Bun.spawn() + Bun.$ | 10-100x faster than Node, native NDJSON streaming |
| **CLI abstraction** | Build | Custom event normalizer on Bun APIs | ~1 week, no libraries exist for this |
| **Git worktree manager** | Build | Custom wrapping git via Bun.$ | 3-5 days, no open-source equivalent |
| **File-based protocol** | Build | Custom with Zod + @parcel/watcher | ~1 week |
| **Re-planning engine** | Build | Custom with git rollback capability | 2-3 weeks |
| **Security/sandboxing** | Build | Hook-based policy engine | 1-2 weeks, follows Claude Code pattern |
| **Code indexing** | Hybrid | tree-sitter + port Aider's repo map | 1-2 weeks |
| **Context management** | Build | Custom hierarchical manager | 1-2 weeks |
| **Multi-agent consensus** | Build | Custom slot-based pipeline | 2-3 weeks |
| **Schema validation** | Adopt | Zod v4 | — |
| **File watching** | Adopt | @parcel/watcher | — |
| **Edit formats** | Port | Aider's search/replace + udiff → TS | ~1 week |

**Key architectural insights from research:**
1. **Bun's native APIs eliminate execa** — 10-100x faster spawn times, native NDJSON streaming
2. **CLIs are already complete coding agents** — All four target CLIs retain full tool-use capabilities in headless mode (read/edit files, bash, git). AFK doesn't need custom tool harness, just process manager and event normalizer
3. **XState for supervisor, not LangGraph** — XState is philosophically correct for deterministic supervisor. LangGraph could be used in agent harness layer if needed, but keep agent scaffold minimal
4. **Hook-based security follows Claude Code's pattern** — PreToolUse hooks approve/deny/modify tool calls before execution
5. **Simplicity wins for agents** — Mini-SWE-agent achieves 74% on SWE-bench in 100 lines of bash. Keep agent scaffold minimal, invest complexity in orchestration/reliability/recovery layers

### 2.2 Storage Model

**Dual storage at two levels (global + per-repo) with clear boundaries:**

**Global state (`~/.afk/`):**
- **Global SQLite** (`~/.afk/afk.db`): Repo registry (path, alias, status), global dispatch queue (incoming PRDs before routing), cross-repo session tracking, intake source → repo routing rules
- **Config**: Global config defaults, provider registry, model catalog, CLI binary paths
- **Default workflows**: Shipped with AFK, copied to repo on `afk init`
- **Default policies**: Global baseline security rules
- **Memory**: Cross-repo failure gates, global learnings
- **Secrets**: Telegram token, Linear API key, provider credentials

**Per-repo state (`<repo>/afk/`):**
- **Files (agent protocol)**: What agents read and write. Markdown, YAML, JSON, JSONL. Examples: `plan.yaml`, `MEMORY.md`, `decisions.jsonl`, `step_input.json`, `step_complete.json`. Human-readable, debuggable with `cat`
- **Repo SQLite** (`<repo>/afk/sessions.db`): Projects, Tasks, Sessions, Events, Messages. Project→task→worktree relationships, event streams, token accounting, consensus results. WAL mode (unlimited concurrent readers + one writer)
- **Workflows** (`<repo>/afk/workflows/`): Copied from global defaults on init, fully customizable per repo. YAML definitions only — no code. Validated by AFK before execution
- **Policies** (`<repo>/afk/policy.yaml`): Repo-specific security rules. Evaluated at execution time alongside global policy (deny always wins)
- **Memory**: `MEMORY.md`, `active-context.md`, `ROUTER.md`, `decision-index.jsonl`

**Boundary principle:** Files are what agents see; SQLite is what the supervisor queries. Global DB tracks cross-repo dispatch; repo DB tracks within-repo execution.

### 2.3 Directory Structure Principles

The exact layout will be refined during implementation. Core principles:

**Global (`~/.afk/`):**
1. **Single installation, multi-repo** — global daemon manages all registered repos
2. **Repo registry in global SQLite** — maps aliases to paths, tracks active sessions
3. **Default workflows and policies ship with AFK** — copied to repo on `afk init`
4. **Secrets never leave global** — Telegram tokens, API keys stored only in `~/.afk/secrets/`

**Per-repo (`<repo>/afk/`):**
1. **`afk/` is local-only and gitignored** — ephemeral session state, not project source code
2. **Created by `afk init` or auto-created on first `afk handoff`** — registers repo in global DB, copies default workflows/policies
3. **Workflows are repo-local YAML** — copied from defaults, fully customizable per repo. Validated before execution to prevent runtime crashes
4. **Per-project state is isolated** — each project has its own subdirectory under `afk/projects/<n>/`
5. **Shared context is accessible to all projects** — `MEMORY.md`, `ROUTER.md`, workflow definitions, specs
6. **Repo SQLite tracks relationships** — project→worktree→branch mapping, task dependencies, session state

---

## 3. Implementation Phases

### Phase 0: Architecture Validation Spikes (2-3 days)

**Goal:** De-risk core architectural decisions before building

**Spikes:**

1. **XState + SQLite persistence spike** (1-2 days)
   - Define minimal 3-step workflow (analyze → implement → test) as XState machine
   - Verify hierarchical/nested machines work (pipeline-level wrapping task-level)
   - Serialize snapshots to SQLite via `bun:sqlite`
   - Verify checkpoint/resume works after simulated crash
   - Validates: XState as foundation, nested machines for pipeline model, SQLite as persistence layer
   - Success criteria: Can restore exact machine state from SQLite after kill -9

2. **CLI abstraction spike** (1 day)
   - Spawn Claude Code with `--output-format stream-json`
   - Parse NDJSON events into common `AgentEvent` type
   - Verify tool-use capabilities work in headless mode
   - Validates: Bun.spawn() pattern, NDJSON normalization, headless agent capabilities
   - Success criteria: Can spawn agent, capture events in real-time, detect completion

3. **Git worktree crash recovery spike** (half day)
   - Create worktree, intentional SIGKILL, startup reconciliation
   - Handle orphaned/locked worktrees
   - Validates: Worktree lifecycle management
   - Success criteria: Can detect and clean orphaned worktrees on startup

**Outcome:** Architectural foundation validated or pivoted before building on it

### Phase 1: Core Deterministic Loop (3-4 weeks)

**Goal:** Minimal end-to-end workflow execution with one provider (Claude Code)

**Components to build:**

1. **CLI abstraction layer** (1 week)
   - `CLIProviderV1` interface
   - Claude Code adapter (first provider)
   - Event normalization to common `AgentEvent` union type
   - Model tier abstraction (frontier/standard/fast → concrete models)
   - Built on: Bun.spawn() for agents, Bun.$ for git commands

2. **Workflow engine** (1 week)
   - XState v5 machine definitions (start with `default` task-level workflow)
   - YAML → JSON → XState machine pipeline
   - Step transition logic (task-level; pipeline-level nesting added in Phase 3)
   - SQLite persistence layer for state snapshots
   - Workflow step contract (input/output files)

3. **Git worktree manager** (3-5 days)
   - Lifecycle: create → use → remove
   - Startup reconciliation (handle orphaned worktrees)
   - Project → worktree → branch mapping
   - Crash recovery

4. **File-based protocol** (1 week)
   - Zod schemas for all agent-facing files
   - File watcher (@parcel/watcher) for step completion detection
   - Atomic writes (write-file-atomic)
   - Protocol: supervisor writes `step_input.json`, agent writes `step_complete.json`

5. **Heartbeat supervision** (2-3 days)
   - Agent writes heartbeat file every N seconds
   - Supervisor monitors staleness
   - Auto-restart on stale heartbeat
   - Restart limit enforcement

6. **Minimal workflow steps** (1 week)
   - PREP: Run tests, fix existing failures
   - IMPLEMENT: Write code based on spec
   - VALIDATE: Supervisor runs tests/linter
   - COMMIT: Atomic commit with task metadata
   - (Defer ANALYZE, TEST_PLAN, CLEANUP, SIMPLIFY, REVIEW to Phase 3)

**Success criteria for Phase 1:**
- Can execute simple task spec end-to-end
- Survives agent crash and restarts
- Produces atomic commits
- State persists across supervisor restarts

**Explicitly deferred:**
- Global daemon, multi-repo management, routing (Phase 6)
- Multi-provider support (Claude-only in Phase 1)
- Consensus mode
- Pipeline-level workflows (intake, research, amend, re-plan)
- Review loops
- Custom task-level workflows beyond `default`
- Memory layers beyond always-loaded context
- Human gates and autonomy modes

### Phase 2: Multi-Provider + Consensus (2-3 weeks)

**Goal:** Provider-neutral orchestration with consensus capability

**Components to build:**

1. **Provider abstraction completion** (1 week)
   - Codex adapter
   - Gemini adapter
   - Copilot adapter (if mature enough for headless use)
   - Provider registry and preference ordering
   - Tier resolution (frontier/standard/fast across providers)

2. **Quota management + failover** (3-5 days)
   - Detect quota hits from CLI output
   - Backoff logic
   - Automatic failover to next provider
   - Provider status tracking (`~/.afk/provider-status.json`)

3. **Consensus implementation** (1-2 weeks)
   - Slot-based fan-out for analysis steps
   - Per-slot provider assignment with quota-aware fallback
   - Synthesis agent (merges N analyses into unified output)
   - Consensus result storage (within project file structure, not separate top-level)
   - Configure which steps run in consensus mode (workflow YAML)

**Success criteria for Phase 2:**
- Can execute same task with different providers
- Automatic failover when quota hit
- Consensus mode produces enriched analysis
- Provider-neutral file protocol (doesn't care which CLI produced output)

### Phase 3: Pipeline Workflows + Review + Re-Planning (4-6 weeks)

**Goal:** Full pipeline from PRD to mergeable branch — intake, deep research, plan amendment, review loops, and adaptive re-planning. Assumes work is already targeted at a specific repo (global routing and repo scaffolding are Phase 6).

**Components to build:**

1. **Pipeline engine** (1 week)
   - Pipeline-level workflow execution (chain of workflows with state transfer)
   - Workflow I/O contracts (declared inputs/outputs per workflow)
   - State transfer between workflows via file protocol
   - Pipeline definitions for `afk handoff`, `afk start`, `afk research`
   - Nested XState machines (pipeline-level wrapping task-level)

2. **INTAKE workflow** (1 week)
   - Input classifier (task/bug/prd/research/vague)
   - PRD decomposition into dependency-ordered project/task graph
   - Spec generation per task
   - **Research flag detection:** Identifies areas requiring deeper investigation before implementation (technology choices not yet decided, multiple viable approaches with tradeoffs, integration unknowns, performance/scaling questions)
   - Direct spec creation for simple tasks (bypass research)
   - Runs as first pipeline stage, doesn't block main loop for simple inputs

3. **RESEARCH workflow** (1-2 weeks)
   - PLAN step: Decompose research question into sub-question DAG (frontier tier)
   - INVESTIGATE step: Parallel subagents per independent sub-question using consensus-like fan-out. Each subagent runs search-evaluate-refine loop (broad query → evaluate → narrow → repeat)
   - SYNTHESIZE step: Merge all findings, identify themes, flag remaining gaps (frontier tier, fresh context)
   - GAP-FILL: Optional targeted follow-up for identified gaps (iteration-capped)
   - PRODUCE step: Structured research report to `afk/context/research/<topic>.md`
   - Effort scaling: configurable sub-question budget, per-subagent tool call budget, max refinement rounds

4. **AMEND workflow** (1 week)
   - Reads original PRD + all research reports + initial plan
   - Adjusts plan structure (add/remove/reorder tasks, change project grouping)
   - Updates specs with research-informed decisions
   - Revises task dependencies
   - Writes decision-index entries for choices made during research
   - Validates amended plan coherence

5. **Review loop** (1 week)
   - REVIEW step with persona-based reviewers
   - DISTILL sub-step (deduplicate findings, prioritize)
   - Diff comparison for stuck detection
   - Review round counting and limits
   - Transition back to IMPLEMENT on needs-changes

6. **REPLAN workflow** (2-3 weeks)
   - Detect plan invalidation signals during implementation
   - Re-plan with accumulated context (original PRD + research reports + implementation progress)
   - **Revert logic:** Identify tainted commits, `git revert` them
   - Can trigger RESEARCH workflows if re-plan reveals new unknowns
   - Reconciliation: keep/redo/add/remove tasks
   - Re-plan budget enforcement (prevent infinite loops)

7. **Extended task-level workflow steps** (1 week)
   - ANALYZE (optional consensus mode)
   - TEST_PLAN (write tests first)
   - CLEANUP (remove dead code)
   - SIMPLIFY (surface-level clarity)
   - Full default task workflow: PREP → PICK → ANALYZE → TEST_PLAN → IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW → VALIDATE → COMMIT

**Success criteria for Phase 3:**
- `afk handoff <prd>` runs full pipeline: intake → research → amend → implementation
- Research workflows produce actionable reports that visibly improve spec quality
- Amended plan reflects research findings (changed dependencies, informed technology choices)
- Review loops with automatic fix iterations
- Re-planning triggered on plan invalidation, can invoke research if needed
- Revert capability resets to known-good state

### Phase 4: Memory + Context Management (2-3 weeks)

**Goal:** Intelligent context injection and codebase navigation

**Components to build:**

1. **Memory layers** (1 week)
   - Layer 1: Always-loaded context (`MEMORY.md`, `active-context.md`, `ROUTER.md`)
   - Layer 2: Tree-sitter repo map (port from Aider)
   - Layer 3: Failure gates (past errors modify supervisor behavior)
   - (Defer Layer 4: Decision index search, Layer 5: Session-end learning ritual)

2. **Repo map generation** (1-2 weeks)
   - Port Aider's tree-sitter repo map to TypeScript
   - Graph-ranked relevance for context prioritization
   - Regenerate on commits (codebase changed)
   - Integration with step prompts

3. **Context budget management** (3-5 days)
   - Pre-step context window estimation
   - Truncate/prioritize when over budget
   - Track token usage per step

**Success criteria for Phase 4:**
- Agents receive relevant code context via repo map
- Memory layers inject appropriate context per step
- Context budget respected (no token limit errors)

### Phase 5: Autonomy + Human Gates (1-2 weeks)

**Goal:** Variable autonomy with resume tokens

**Components to build:**

1. **Autonomy mode configuration** (3-5 days)
   - Full/supervised/assisted mode definitions
   - Per-step gate configuration
   - Mode switching mid-session

2. **Resume tokens** (1 week)
   - Checkpoint serialization on gate hit
   - Token generation and validation
   - Resume from exact checkpoint
   - CLI commands: `afk approve <token>`, `afk deny <token>`

3. **Notification system** (2-3 days)
   - Telegram integration (outbound notifications only; bidirectional dispatch in Phase 6)
   - Gate notifications
   - Session status updates
   - Error alerts

**Success criteria for Phase 5:**
- Can pause at gates in supervised mode
- Resume from checkpoint after approval
- Notifications sent to Telegram

### Phase 6: Global Daemon + Integration + Polish (3-4 weeks)

**Goal:** Global daemon, external intake surfaces, repo management, production readiness

**Components to build:**

1. **Global daemon** (1 week)
   - Single persistent process managing all registered repos
   - Repo registry in global SQLite (path, alias, status, active sessions)
   - Per-repo session lifecycle: independently startable/stoppable
   - Cross-repo status tracking (`afk status` shows all active work)
   - Graceful handling of concurrent sessions across multiple repos

2. **Intake routing** (3-5 days)
   - ROUTE workflow: match incoming work to registered repo by explicit name/alias
   - Telegram dispatch: message must include repo name (e.g., `/handoff project-alpha <prd>`)
   - Linear dispatch: ticket tag or project mapping to repo alias
   - Clarification flow: if name doesn't match, respond with list of known repos
   - CLI within repo directory: implicit routing (current repo)

3. **Repo scaffolding** (3-5 days)
   - SCAFFOLD workflow: `git init` → template → `afk init` → register in global DB
   - `afk init` in existing repo: create `afk/` directory, copy default workflows/policies, register
   - `afk new <name>` from anywhere: scaffold new repo in configured workspace directory
   - Telegram: `/new <name> <prd>` triggers scaffold → full pipeline
   - Workflow validation on init (ensure copied YAML is valid before execution)

4. **Linear integration** (1 week)
   - Polling for `afk-ready` tickets via global daemon
   - Bi-directional status sync
   - Conflict resolution (always refetch, never assume)
   - Repo routing via Linear project → repo alias mapping

5. **Security/sandboxing** (1-2 weeks)
   - Hook-based policy engine (follows Claude Code pattern)
   - AWS-style deny-wins unified policy
   - Four-layer policy stacking (global/repo/session/step)
   - Global policy evaluated at execution time alongside repo policy

6. **Exploration mode** (1 week)
   - Triggers when task queue empties
   - Bug finding, improvement proposals
   - Clearly tagged exploratory commits

7. **CLI polish** (1 week)
   - All commands: start, pause, resume, handoff, new, init, adopt, drop, status, report, etc.
   - `afk status`: cross-repo overview from global daemon
   - `afk status --repo <name>`: repo-specific detail
   - Terminal UI for `afk status` (blessed/ink)
   - Error handling and user messaging

**Success criteria for Phase 6:**
- Global daemon runs, manages multiple repos simultaneously
- Telegram/Linear dispatch routes to correct repo by explicit name
- New repo scaffolded from Telegram command, runs full pipeline
- Linear tickets auto-picked up and synced
- Security policies enforced across global and repo layers
- Exploration mode produces proposals

### Phase 7: macOS App (Optional, 3-4 weeks)

**Goal:** Native desktop experience

**Tauri v2 app:**
- React + Tailwind frontend
- Reads same `afk/` files as CLI
- Live dashboard, decision graph visualization
- Review interface for gates
- Session reports

**Rationale for deferred:** CLI-first development validates core loop without UI complexity. App adds convenience but isn't required for functionality.

---

## 4. Key Systems Architecture

### 4.1 Workflow Engine

**Supervisor-controlled state machine at two levels:**

**Pipeline-level workflows** define the chain of activities for a session's goal. The supervisor executes them sequentially (or conditionally), passing accumulated state between them. Different entry points use different pipeline definitions:

```
afk handoff <prd>:           INTAKE → RESEARCH → AMEND → IMPLEMENTATION
afk handoff <prd> (new repo): SCAFFOLD → INTAKE → RESEARCH → AMEND → IMPLEMENTATION
afk start:                   IMPLEMENTATION (specs already exist)
afk research <q>:            RESEARCH → PRODUCE (standalone report)
Telegram/Linear dispatch:    ROUTE → (one of the above, depending on routing result)
```

**Routing** happens at the global daemon level, before any repo-scoped pipeline. For CLI commands within a repo directory, routing is implicit (current repo). For Telegram/Linear, routing is explicit: the message must include a repo name/alias. If the name doesn't match a registered repo, the daemon responds with the list of known repos to clarify. New repo scaffolding is triggered by explicit command (e.g., `/new <name> <prd>`).

Each stage in the pipeline is itself a workflow with defined inputs, outputs, and completion conditions. The supervisor handles state transfer: each workflow writes outputs to well-known file locations, and downstream workflows receive them as injected context.

**Task-level workflows** define the step sequence for executing a single task within a project. These are the configurable YAML-defined step sequences:

```
Default:  PREP → PICK → ANALYZE → TEST_PLAN → IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW → VALIDATE → COMMIT
                                                   ↑                              │
                                                   └──────────────────────────────┘
                                                        (needs-changes loop)

Bugfix:   PREP → IMPLEMENT → REVIEW → VALIDATE → COMMIT
```

**Pipeline-level workflow definitions (built-in):**

- **ROUTE:** Global daemon level. Matches incoming work (Telegram message, Linear ticket) to a registered repo by explicit name/alias. If no match, responds with list of known repos to clarify. For CLI commands within a repo directory, routing is implicit
- **SCAFFOLD:** Creates a new repo for work that doesn't belong to any existing repo. `git init` in configured workspace directory, optional template, `afk init` to create `afk/` directory with default workflows/policies, register in global DB
- **INTAKE:** Classifies input, decomposes PRD into dependency-ordered project/task graph, generates initial specs, flags areas requiring deeper research before implementation can proceed
- **RESEARCH:** Parallel deep investigation of flagged areas. Internal steps: PLAN (decompose question into sub-question DAG) → INVESTIGATE (parallel subagents per sub-question, each running search-evaluate-refine loops) → SYNTHESIZE (merge findings, identify themes, flag gaps) → GAP-FILL (optional targeted follow-up) → PRODUCE (structured research report). Uses consensus-like fan-out for parallel investigation
- **AMEND:** Re-reads original PRD + all research reports, adjusts plan structure, updates specs, revises task dependencies, writes decision-index entries for choices made
- **REPLAN:** Invoked when plan invalidation detected mid-implementation. Assesses damage → identifies tainted commits → reverts → re-decomposes. Can trigger RESEARCH workflows if re-plan reveals new unknowns
- **IMPLEMENTATION:** Per-project, per-task execution using the assigned task-level workflow

**XState implementation:** Pipeline-level and task-level workflows are nested state machines in XState v5 — hierarchical states are a native capability. Pipeline transitions (intake done → research → amend → implementation) and task transitions (PREP → IMPLEMENT → REVIEW → COMMIT) share the same engine.

**Step execution pattern (unchanged at task level):**
1. Supervisor writes `step_input.json` (step name, task context, memory injection, repo-map, previous output)
2. Supervisor spawns agent CLI with appropriate flags
3. Agent performs work within step constraints
4. Agent writes `step_complete.json` (status, output data, decisions made)
5. Supervisor reads completion, validates against schema
6. Supervisor resolves next step from workflow transitions

**Workflow I/O contracts:** Each pipeline-level workflow declares what it produces and what it consumes. The supervisor manages state transfer between workflows via file protocol — outputs written by one workflow become available context for downstream workflows. Exact file locations and schemas are defined during implementation.

### 4.2 CLI Abstraction Layer

**Architecture:**
```typescript
interface CLIProviderV1 {
  spawn(task: TaskContext, step: StepName): Process;
  normalizeEvent(raw: string): AgentEvent;
  resolveModel(tier: 'frontier' | 'standard' | 'fast'): ModelConfig;
}

type AgentEvent = 
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; name: string; input: any }
  | { type: 'tool_result'; result: any }
  | { type: 'completion'; message: string }
  | { type: 'error'; error: string };
```

**Per-provider adapter:**
- Claude: `claude -p <prompt> --output-format stream-json --allowedTools "Read,Edit,Bash"`
- Codex: `codex exec --json`
- Gemini: `gemini -p <prompt> --output-format stream-json --yolo`
- Copilot: (less mature, evaluate during Phase 2)

**Key insight:** All CLIs retain full tool-use capabilities in headless mode. No custom tool harness needed — just normalize events and let CLI handle execution.

### 4.3 Consensus Implementation

**Slot-based fan-out/fan-in:**

1. **Fan-out:** For consensus-enabled step (e.g., ANALYZE), supervisor spawns N agents in parallel
   - Each agent: separate process, independent analysis
   - Slot assignment: provider preference order with quota-aware fallback
   - Timeout per slot (kill if exceeds)
   - Outputs written to `afk/projects/<name>/step-analyze-iter-M/slot-N/`

2. **Synthesis:** After all slots complete, synthesis agent (frontier tier) runs
   - Input: All N analyses
   - Output: Unified, enriched analysis
   - Removes contradictions, merges complementary findings
   - Produces single coherent output for subsequent steps

3. **Integration:** Enriched analysis provided to IMPLEMENT step
   - Implementation agent receives benefit of multiple perspectives
   - Single agent writes code, not N parallel implementations

**Configuration:**
```yaml
consensus:
  slots: 3
  preferred_providers: [claude, codex, gemini]
  fallback_providers: [copilot]
  synthesis_tier: frontier
  timeout_per_slot_seconds: 300
```

### 4.4 Re-Planning with Revert

**REPLAN is a pipeline-level workflow**, not a special-case step. When plan invalidation is detected mid-implementation, the supervisor pauses the affected project and invokes the REPLAN workflow, which can itself chain to RESEARCH and AMEND workflows if new unknowns emerge.

**Trigger conditions:**
1. Agent signals plan invalidation (spec assumptions wrong)
2. Review identifies scope creep (work outside spec boundary)
3. Dependency contradiction (task-B discovers task-A's implementation contradicts task-B's spec)
4. Repeated implementation failure (N failed IMPLEMENT→REVIEW loops)

**Re-plan flow:**

1. **Pause:** Supervisor pauses affected project
2. **Re-plan:** Re-planner agent (frontier tier) receives:
   - Original PRD
   - Current plan with completion status
   - Evidence of why plan broke
   - Git log of all commits
   - Current codebase state (repo-map)
3. **Revert instructions:** Re-planner outputs:
   - Tasks to REVERT (commits built on wrong assumptions)
   - Revert depth (how far back to reset)
   - Reasoning about which commits are tainted vs. valid
4. **Apply revert:** Supervisor executes `git revert <commit>` for each tainted task
   - Resets worktree to known-good state
   - Update task status: "reverted"
   - Full history preserved (no `git reset`)
5. **Reconciliation:** Supervisor applies plan changes:
   - Reverted tasks: re-queue with updated specs
   - Kept tasks: no change
   - Waiting tasks: update specs, re-evaluate dependencies
   - New tasks: add to plan
6. **Research if needed:** If re-plan reveals new unknowns, chain to RESEARCH → AMEND workflows before resuming
7. **Resume:** Execution continues from stable point with updated plan

**Guardrails:**
- Re-plan budget (max N per session, default 3)
- Evidence requirement (concrete plan_invalidation decision, not vague "might be wrong")
- Human gate option (supervised/assisted mode can require approval for reverts)

**Philosophy:** Building fixes on wrong foundation creates compounding errors. Revert to known-good state + rebuild with correct understanding is cleaner than inheritance of bad decisions.

### 4.5 Security Model

**Hook-based policy engine (follows Claude Code pattern):**

**PreToolUse hook:**
- Intercepts every tool call before execution
- Evaluates against unified policy (all four layers: global/repo/session/step)
- Actions: approve / deny / modify
- Exit code 2 = block action + send correction feedback to agent

**Policy structure:**
```typescript
interface PolicyStatement {
  effect: 'allow' | 'deny';
  resources: string[];        // glob patterns: ["src/**/*.ts", "!src/secrets/*"]
  actions: string[];          // ["read", "write", "bash", "git"]
  conditions?: Condition[];   // optional conditions (time, user, etc.)
}
```

**Deny-wins logic:**
- If any policy says deny → denied
- Requires explicit allow to proceed
- Defense-in-depth without complexity

**Four policy layers (evaluated at execution time, deny always wins):**
1. **Global** (`~/.afk/policy.yaml`): Baseline restrictions across all repos
2. **Repo** (`<repo>/afk/policy.yaml`): Repo-specific rules, copied from global defaults on init, customizable
3. **Session** (runtime config): Session overrides
4. **Step** (workflow definition): Per-step constraints

### 4.6 Memory System

**Five layers (Phase 4 implements 1-3, defer 4-5):**

**Layer 1: Always-loaded context**
- `MEMORY.md`: Architecture, patterns, conventions
- `active-context.md`: Current focus, recent decisions
- `ROUTER.md`: Points agent to relevant code/docs areas
- Injected into every agent prompt

**Layer 2: Tree-sitter repo map**
- Structural code index (classes, functions, imports)
- Graph-ranked relevance (ported from Aider)
- Searchable on-demand
- Regenerated on commits (codebase changed)

**Layer 3: Failure gates**
- Past errors that modify supervisor behavior
- Example: "Never trust test X" → supervisor skips that test in VALIDATE
- Max 20 gates (keep focused)
- Stored in `~/.afk/memory/failure-gates.md`

**Layer 4: Decision index (deferred)**
- Searchable log of all decisions (`decisions.jsonl`)
- Tag-based retrieval
- Enables "Why did we choose X?" queries

**Layer 5: Session-end learning ritual (deferred)**
- Post-session synthesis of patterns and lessons
- Updates global learnings
- Requires steep value curve to justify complexity

---

## 5. Unresolved Pre-Coding Decisions

These must be resolved before implementation begins:

### 5.1 Step Contract / File Protocol Overlap

**Problem:** Potential source-of-truth ambiguity between `decisions.jsonl` and `step_complete.json`

**Questions:**
- Should `step_complete.json` duplicate decision summaries, or just reference `decisions.jsonl`?
- Who is authoritative for "what decisions were made in this step"?
- How do we avoid drift between the two files?

**Options:**
1. `step_complete.json` references decision IDs from `decisions.jsonl` (single source of truth)
2. `step_complete.json` includes decision summaries, `decisions.jsonl` is canonical detail
3. `decisions.jsonl` is append-only audit log; `step_complete.json` is just status/output (no decision overlap)

**Resolution needed before:** Phase 1 file protocol implementation

### 5.2 Loop Explosion Risk

**Problem:** Combined review/validate/retry could produce ~15 LLM invocations per task without caps

**Current design:**
- IMPLEMENT can iterate multiple times
- REVIEW can run multiple rounds (min 2, max 5)
- Each review round can trigger IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW again
- VALIDATE failures loop back to IMPLEMENT

**Without limits:** 5 IMPLEMENT attempts × 5 review rounds × (IMPLEMENT + CLEANUP + SIMPLIFY + REVIEW per round) = potential explosion

**Questions:**
- What's the global iteration limit per task?
- Do we count CLEANUP/SIMPLIFY as separate iterations, or bundled with IMPLEMENT?
- Does VALIDATE failure count toward iteration limit?
- When do we escalate to needs-input vs. retry?

**Options:**
1. Global task iteration limit (e.g., 15 total LLM calls per task, regardless of step)
2. Per-step iteration limits (e.g., max 3 IMPLEMENT, max 5 REVIEW, etc.)
3. Phase-based limits (main phase vs. review phase vs. validation phase)

**Resolution needed before:** Phase 1 workflow engine implementation

### 5.3 Model Tier Selection Strategy

**Question:** How granular should tier overrides be?

**Options:**
1. Per-workflow-step tier overrides (e.g., ANALYZE always uses frontier, SIMPLIFY uses fast)
2. Per-session tier overrides (all steps use specified tier)
3. Hybrid (workflow defines defaults, session can override)

**Current assumption:** Workflow YAML defines default tier per step, session config can override

**Validation needed:** Spike to determine if step-level control adds value or just complexity

---

## 6. Success Metrics by Phase

**Phase 0 (Spikes):** Architectural decisions validated or pivoted

**Phase 1 (Core Loop):**
- Execute simple task spec end-to-end with Claude Code
- Survive agent crash and auto-restart
- Produce atomic commits with task metadata
- State persists across supervisor restarts

**Phase 2 (Multi-Provider):**
- Same task executes with any of 3+ providers
- Automatic failover when quota hit
- Consensus mode produces enriched analysis

**Phase 3 (Pipeline Workflows):**
- `afk handoff <prd>` runs full pipeline: intake → research → amend → implementation
- Deep research produces reports that improve spec quality
- Amended plan reflects research findings
- Review loops with automatic fix iterations
- Re-planning triggered on invalidation, can chain to research
- Revert resets to known-good state

**Phase 4 (Memory):**
- Agents receive relevant code context via repo map
- Context budget respected (no token errors)
- Memory layers inject appropriate context

**Phase 5 (Autonomy):**
- Pause at gates in supervised mode
- Resume from checkpoint after approval
- Notifications sent to Telegram

**Phase 6 (Global Daemon + Integration):**
- Global daemon manages multiple repos simultaneously
- Telegram/Linear dispatch routes to correct repo by explicit name
- New repo scaffolded from remote command, runs full pipeline
- Linear tickets auto-picked up
- Security policies enforced across global and repo layers
- Exploration mode produces proposals

---

## 7. Non-Goals and Explicit Exclusions

**Not building:**
- IDE integration (VSCode, Cursor)
- Real-time chat interface (non-conversational by design)
- Generic API wrappers (use specific CLI binaries)
- Cloud deployment (macOS-only tool)
- Web UI (macOS app only)

**Deferred until core proven:**
- Assisted autonomy mode (full autonomy is core use case)
- Memory layers 4-5 (steep value curve)
- Distributed execution (single machine is fine)

---

## 8. Open Questions for Future Phases

These don't block early phases but need resolution eventually:

1. **Repo map information density:** Does tree-sitter repo map provide enough value vs. cost? (Spike in Phase 4)
2. **Edit format selection:** Port all Aider edit formats (search/replace, udiff, whole-file) or just one? (Decide in Phase 2)
3. **Consensus synthesis model:** Same tier as slots, or always frontier? (Decide in Phase 2)
4. **Session resume across reboots:** Persist enough state to resume multi-hour sessions after machine restart? (Decide in Phase 5)
5. **Exploration mode triggers:** Token budget exhaustion, or idle time threshold? (Decide in Phase 6)
6. **Research depth calibration:** How does the INTAKE workflow determine which areas need deep research vs. quick lookup vs. no research? Classification heuristics need experimentation with real PRDs. (Decide in Phase 3)
7. **Research tool access:** Which CLI providers have web search/fetch capabilities in headless mode? Research workflow quality depends on tool access. (Spike in Phase 3)
8. **Pipeline-level state transfer format:** How much context from upstream workflows should downstream workflows receive? Full reports vs. summaries vs. decision entries only? Context budget implications. (Decide in Phase 3)
9. **Daemon lifecycle:** How does the global daemon start? Launchd service on macOS? Started on first `afk` command and stays alive? Manual `afk daemon start`? What happens on machine reboot — auto-resume active sessions? (Decide in Phase 6)
10. **Multi-session per repo:** When two PRDs target the same repo, do they share worktrees or get fully independent worktree sets? How do concurrent sessions within one repo avoid stepping on each other? (Decide in Phase 6)
11. **Workflow validation depth:** How deep should YAML workflow validation go before execution? Schema-only (correct fields/types)? Or also semantic validation (referenced steps exist, transitions are reachable, no cycles)? (Decide in Phase 1)
12. **Cross-repo learnings:** Should failure gates and decision patterns propagate across repos? A lesson from repo A might apply to repo B if they share a tech stack. How selective should this be? (Decide in Phase 4)

---

## Document Status

**Last updated:** 2026-03-29
**Revision:** 1.2 (global daemon model: AFK as globally installed CLI with single daemon, multi-repo management, repo-local workflows, routing, scaffolding; pipeline-of-workflows model from 1.1 retained)

**Change policy:** This document captures validated architectural decisions. Changes require:
1. Clear rationale (what new information invalidates prior decision)
2. Impact assessment (what already-built components are affected)
3. Migration path (how to transition from old to new design)

**Next steps:** Resolve unresolved decisions (§5), then proceed to Phase 0 spikes.
