# AFK — Framework Architecture

## 1. Core Concepts

### Mental Model

AFK is a **workflow builder and orchestrator** for autonomous coding agent sessions. The primary interaction is the **handoff**: you drop a PRD, research document, or task description, and AFK breaks it down into an executable plan, generates specs, and implements them using configurable, deterministic workflows. When multiple PRDs or feature sets target the same repo, each runs as an isolated **Project** — a first-class entity with its own worktree, branch, plan, and sequential task execution. A companion UI (macOS app via Tauri) and CLI both read the same state files.

### Entity Hierarchy

```
Session (one `afk start` invocation)
  └── Project (1 project = 1 worktree = 1 branch = 1 plan = N sequential tasks)
      ├── Project "auth-system"  → worktree → branch afk/auth-system
      ├── Project "payment-api"  → worktree → branch afk/payment-api
      └── Project "dashboard"    → worktree → branch afk/dashboard
```

A **Project** is the unit of isolation and the unit of delivery. Each project produces a single branch that you merge or discard. Within a project, tasks execute sequentially, respecting dependency order from the plan. Multiple projects run in parallel, each in its own worktree. The SQLite database tracks project → task → worktree relationships.

### Key Principles

- **File-first + SQLite**: The agent-facing protocol is human-readable files — agents write to files, the next agent reads from files, you review files. The supervisor uses SQLite for operational data (session tracking, project-task-worktree relationships, events, messages, token accounting) that benefits from structured queries. Files are the agent interface; SQLite is the supervisor's internal state.
- **Handoff-driven**: The primary interaction is dropping a document (PRD, research output, spec) and getting implementation back. The intake pipeline breaks input into an executable plan with dependency-ordered tasks.
- **Project isolation**: Each project (a PRD, a feature set, a research spike) gets its own git worktree and branch. Multiple projects on the same repo run in parallel without interference. Each produces a clean, mergeable branch as its deliverable.
- **Workflow-first**: Every execution follows a named workflow — a typed sequence of steps with transitions, conditions, and consensus configuration. The `default` workflow covers the full planning-to-commit cycle. Custom workflows are first-class.
- **Consensus for understanding, single agent for execution**: When multiple perspectives improve the outcome, planning and analysis steps run in consensus mode — multiple agents analyze independently, then a synthesis agent merges their findings. Implementation uses one capable model with the benefit of a consensus-enriched plan.
- **Adaptive planning with revert**: When mid-execution evidence proves the plan is wrong, AFK automatically re-plans with accumulated context. Crucially, the re-planner can instruct the supervisor to **revert** the last N commits or tasks — resetting the project's worktree to a known-good state before continuing in a new direction. Building fixes on top of a wrong foundation is worse than reverting and rebuilding.
- **Deterministic orchestration, creative execution**: The supervisor controls the loop (step transitions, review counting, phase changes, re-planning) deterministically in code. The agent handles the creative work within each step. Orchestration is never delegated to the LLM via markdown instructions.
- **Heartbeat supervision**: Agents write heartbeat files. The supervisor watches. Stale heartbeat = dead/stuck agent = automatic restart from last checkpoint.
- **Atomic commits = atomic units of review**: Each completed task = one squashable commit. You cherry-pick the ones you want, drop the rest.
- **Security by default-deny**: Agents operate under an AWS-style unified security policy where deny always wins. Policies stack across four layers (global, repo, session, step) using a single schema. Agents can only access what is explicitly allowed.
- **Global tool, per-repo sessions, project-capable**: AFK is installed globally (`~/.afk/` for config, memory, secrets, provider status) with per-repo sessions (`afk/`). AFK can also create new projects from scratch (`afk new`), not just operate on existing repos.
- **Variable autonomy**: Three runtime modes (full, supervised, assisted) control human-in-the-loop gates. Full autonomy overnight, supervised execution during the day, assisted mode for new or sensitive repos. Switchable mid-session.
- **Provider-neutral CLI routing**: AFK spawns local CLIs (`claude`, `codex`, `gemini`, `copilot`), not APIs. A model catalog maps neutral tiers (frontier, standard, fast) to concrete models. Providers fail over automatically; the file protocol doesn't care which CLI produced the commit.
- **Exploration mode**: When the task queue empties, agents can switch from "implement specs" to "explore codebase" — finding bugs, suggesting improvements, writing proposals. These are clearly tagged as exploratory and never auto-merged.

---

## 2. Directory Structure

> **Note**: The directory layouts below are **directional suggestions**, not a concrete specification. The exact structure will be refined during implementation. The principles are what matter: `afk/` is local-only, per-project state is isolated, shared context is accessible to all projects.

### Layout Principles

```
~/.afk/                     # Global config, memory, secrets, provider status
<repo>/afk/                 # Repo-local: session state, context, projects (ALL gitignored)
```

**The entire `afk/` directory is local-only and gitignored.** It is not committed to the repo. This is ephemeral session state, not project source code. The deliverables from AFK are the code changes and commits in each project's branch — not the orchestration files.

```gitignore
# .gitignore
afk/
```

### `afk/` — The Session Directory (Local Only)

The repo-local `afk/` directory contains session configuration, shared context, and per-project runtime state. Everything here is local. The suggested layout:

```
<repo>/afk/
├── config.yaml                      # Session configuration
├── policy.yaml                      # Repo-level security policy
├── sessions.db                      # SQLite: projects, tasks, worktrees, events, sessions
├── MEMORY.md                        # Project memory — architecture, patterns, conventions
├── active-context.md                # Current focus — what's in flight, recent decisions
├── repo-map.json                    # Tree-sitter structural index (regenerated)
├── decision-index.jsonl             # Past decisions, searchable by tag
│
├── workflows/                       # Workflow definitions
│   ├── default.yaml
│   ├── bugfix.yaml
│   └── research.yaml
│
├── inbox/                           # Drop zone for new context / PRDs
│   └── .processed/
│
├── context/                         # Shared knowledge for all projects
│   ├── ROUTER.md                    # Points agent to relevant code/docs areas
│   ├── REVIEW_PERSONAS.md           # Reviewer agent personas
│   ├── steps/                       # Per-step prompt templates
│   │   ├── implement.md
│   │   ├── review.md
│   │   └── ...
│   └── specs/                       # Spec files (generated by planner or written manually)
│
├── projects/                        # Per-project runtime state
│   ├── auth-system/
│   │   ├── plan.yaml                # Dependency-ordered task graph
│   │   ├── heartbeat.json           # Live heartbeat (supervisor reads)
│   │   ├── step_input.json          # Current step context (supervisor writes)
│   │   ├── step_complete.json       # Step result (agent writes)
│   │   ├── decisions.jsonl          # Append-only decision log
│   │   ├── progress.md              # Current status, human-readable
│   │   └── ...                      # Other runtime files as needed
│   └── payment-api/
│       └── ...
│
├── graph/                           # Decision graph data (rebuilt from decisions)
│
├── reports/                         # Session reports
│
└── archive/                         # Completed sessions
```

### SQLite as the Relational Backbone

The `sessions.db` file tracks the relationships that are inherently relational:

- **Projects**: id, name, worktree_path, branch_name, plan_path, status
- **Tasks**: id, project_id, spec_path, workflow, status, depends_on, committed_at
- **Sessions**: id, project_id, task_id, step, provider, model, status, tokens_used
- **Events**: id, session_id, type, data, created_at
- **Messages**: id, session_id, role, content, created_at

This replaces the old `tracks/track-N/` directory model. The supervisor queries SQLite to understand which project is working on which task, which tasks are waiting on dependencies, and where each project's worktree lives.

### Global Directory

```
~/.afk/                              # Global AFK state (not per-repo)
├── config.yaml                      # Global defaults + provider registry + model catalog
├── provider-status.json             # Runtime provider availability (maintained by supervisor)
├── secrets/
│   └── telegram.json                # Bot token + chat ID
├── memory/
│   ├── global-learnings.md          # Cross-repo patterns (<100 lines)
│   ├── model-behavior.md            # Per-provider observations (<50 lines)
│   ├── failure-gates.md             # "Never do X" rules from past failures (max 20 gates)
│   └── provider-stats.jsonl         # Duration, reliability per provider
└── cache/
    └── model-quota-history.json     # Historical quota reset timing per provider
```

### Key File Formats

#### `config.yaml`

```yaml
session:
  name: "afk-2026-03-15"
  autonomy: full                # full | supervised | assisted
  token_budget_per_project: 500000 # optional hard cap per project
  started_at: null               # filled by supervisor
  status: idle                   # idle | running | paused | reviewing

autonomy_modes:
  full:
    # Night shift — agent runs uninterrupted
    human_gates: []
    auto_commit: true
    auto_advance_on_review_cap: true
    escalation: log                    # Log to needs-input, don't block
    linear_status_auto_update: true

  supervised:
    # Day shift with guardrails
    human_gates:
      - before_commit
      - on_review_cap_reached
      - on_subtask_spawn
      - on_replan                      # Require approval before re-plan takes effect
    auto_commit: false
    auto_advance_on_review_cap: false
    escalation: block_and_notify       # Telegram + pause project
    linear_status_auto_update: false

  assisted:
    # Full HITL — every transition requires approval
    human_gates:
      - before_implement
      - before_commit
      - on_review_verdict
      - on_subtask_spawn
      - before_exploration
      - on_replan
    auto_commit: false
    auto_advance_on_review_cap: false
    escalation: block_and_notify
    linear_status_auto_update: false

git:
  local_changes: stash           # stash | commit-wip | fail
  branch_prefix: afk
  worktree_root: ../.afk-worktrees
  base_branch: main              # branch to fork from

heartbeat:
  interval_seconds: 30
  stall_threshold_seconds: 300
  max_restarts_per_project: 3

# ── Workflow defaults ─────────────────────────────────────────────
# The default workflow is loaded from afk/workflows/default.yaml.
# Per-step tier overrides and limits can be set here for the session.
workflow:
  default: default               # Name of the default workflow to use
  max_step_retries: 3            # retry a step before marking needs-input
  stuck_detection: true          # compare diffs between review rounds

# ── Consensus defaults ────────────────────────────────────────────
consensus:
  slots: 3                       # Number of perspectives to gather
  preferred_providers: [claude, codex, gemini]
  fallback_providers: [copilot]
  synthesis_tier: frontier
  timeout_per_slot_seconds: 300

# ── Planning ──────────────────────────────────────────────────────
planning:
  planner_tier: frontier          # Model tier for PRD decomposition
  planner_timeout_seconds: 300    # Max time for planning
  max_tasks_per_plan: 20          # Cap on decomposition
  max_replans_per_session: 3      # Prevent infinite re-planning
  auto_replan: true               # Allow automatic re-planning in full autonomy

# ── Input processing ──────────────────────────────────────────────
intake:
  parse_tier: standard            # Model tier for input classification
  parse_timeout_seconds: 120      # Max time per intake invocation
  auto_decompose: true            # Allow intake to split inputs into multiple tasks
  max_tasks_per_input: 5          # Cap on decomposition for simple inputs
  needs_input_threshold: low      # low = aggressive, high = conservative

# ── Communication ──────────────────────────────────────────────────
communication:
  telegram:
    enabled: false
    # Token and chat_id stored in ~/.afk/secrets/telegram.json, NOT here
    commands: true
    notifications:
      session_started: true
      task_completed: true
      quota_hit: true
      project_failed: true
      needs_input: true
      session_complete: true
      gate_reached: true
      replan_triggered: true     # Notify when automatic re-plan occurs

linear:
  enabled: true
  project_id: "bdc1a89b"
  sync_interval_seconds: 300
  auto_pickup: true
  pickup_filter:
    labels: ["afk-ready"]
    exclude_labels: ["draft", "blocked"]
  status_mapping:
    pickup: "Todo"
    started: "In Progress"
    review: "In Review"
    done: "Done"
    blocked: "Needs Input"
  conflict_resolution: linear_wins
```

#### `heartbeat.json`

```json
{
  "timestamp": "2026-03-15T03:42:00Z",
  "pid": 48291,
  "agent": "claude",
  "step": "implementing",
  "phase": "main",
  "task_id": "auth-flow",
  "subtask": "writing OAuth callback handler",
  "iteration": 3,
  "review_round": 2,
  "tests": {
    "passing": 47,
    "failing": 2,
    "coverage_pct": 82
  },
  "tokens_used": 124500,
  "restarts": 0,
  "quota": {
    "status": "ok",
    "hits": 0,
    "total_wait_seconds": 0,
    "last_hit_at": null
  },
  "project_state": "running",
  "waiting_on": null
}
```

#### `decisions.jsonl` — The Decision Trail

Each line is a JSON object. This is the raw data the decision graph/timeline is built from.

```jsonl
{"ts":"2026-03-15T01:00:00Z","type":"task_start","task":"auth-flow","source":"spec","parent":null}
{"ts":"2026-03-15T01:02:00Z","type":"decision","task":"auth-flow","title":"chose PKCE over implicit flow","reasoning":"spec requires native app support, PKCE is more secure for public clients","alternatives":["implicit flow","device code flow"],"confidence":"high"}
{"ts":"2026-03-15T01:15:00Z","type":"subtask_created","task":"auth-flow","subtask":"token-refresh","reason":"discovered refresh token rotation needed for PKCE compliance","parent":"auth-flow"}
{"ts":"2026-03-15T01:30:00Z","type":"review","task":"auth-flow","round":1,"persona":"architect","verdict":"needs-changes","findings":["missing rate limiting on token endpoint","no CSRF state parameter"]}
{"ts":"2026-03-15T01:45:00Z","type":"pivot","task":"auth-flow","from":"custom JWT validation","to":"jose library","reason":"review found edge cases in custom implementation that jose handles correctly"}
{"ts":"2026-03-15T02:00:00Z","type":"review","task":"auth-flow","round":2,"persona":"architect","verdict":"approved","findings":[]}
{"ts":"2026-03-15T02:05:00Z","type":"test_milestone","task":"auth-flow","passing":23,"failing":0,"coverage_pct":91}
{"ts":"2026-03-15T02:10:00Z","type":"task_done","task":"auth-flow","commit":"abc1234","branch":"afk/auth-system"}
{"ts":"2026-03-15T02:15:00Z","type":"plan_invalidation","task":"auth-middleware","evidence":"auth-service used a different session schema than the spec assumed","triggered_replan":true}
{"ts":"2026-03-15T02:16:00Z","type":"replan","plan":"auth-system-plan","version":2,"changes":{"modified":["auth-middleware"],"added":["auth-session-migration"],"removed":[]}}
{"ts":"2026-03-15T03:00:00Z","type":"quota_hit","agent":"claude","wait_seconds":300,"resumed_at":"...","total_session_wait":600}
{"ts":"2026-03-15T04:00:00Z","type":"phase_change","from":"main","to":"exploration","reason":"task queue empty"}
{"ts":"2026-03-15T04:10:00Z","type":"exploration_finding","category":"bug","file":"src/api/sessions.ts","line":142,"title":"race condition in concurrent session creation","severity":"medium","proposal":"use advisory lock or optimistic concurrency"}
{"ts":"2026-03-15T04:30:00Z","type":"gate_reached","gate":"before_commit","project":"auth-system","task":"auth-flow","resume_token":"abc123"}
```

#### Workflow Definition (`afk/workflows/default.yaml`)

```yaml
name: default
description: Full planning-to-commit cycle for feature work

steps:
  prep:
    tier: standard
    next: pick

  pick:
    tier: fast
    next: analyze

  analyze:
    tier: frontier
    consensus:
      slots: 3
      synthesis_tier: frontier
    next: test_plan

  test_plan:
    tier: standard
    next: implement

  implement:
    tier: frontier
    next: cleanup
    on_review_feedback: implement

  cleanup:
    tier: standard
    next: simplify

  simplify:
    tier: standard
    next: review

  review:
    tier: standard
    personas: [architect, code-expert, test-expert]
    next: distill

  distill:
    tier: standard
    next:
      approved: validate
      needs_changes: implement

  validate:
    tier: fast
    runner: supervisor
    next:
      pass: commit
      fail: implement

  commit:
    tier: fast
    next: done

gates:
  supervised:
    - before: commit
    - on: review_cap_reached
    - on: subtask_spawn
  assisted:
    - before: implement
    - before: commit
    - on: review_verdict
    - on: subtask_spawn

limits:
  max_review_rounds: 5
  min_review_rounds: 2
  max_task_iterations: 15
```

#### Plan (`afk/plans/auth-system-plan.yaml`)

```yaml
source: inbox/auth-prd.md
created_at: "2026-03-15T01:00:00Z"
status: executing
version: 1
replan_history: []

tasks:
  - id: auth-models
    summary: "Create user, session, and token database models"
    spec: specs/auth-models.md
    workflow: default
    depends_on: []
    priority: 1
    status: completed
    committed_at: "2026-03-15T02:30:00Z"

  - id: auth-service
    summary: "Implement authentication service with PKCE OAuth"
    spec: specs/auth-service.md
    workflow: default
    depends_on: [auth-models]
    priority: 2
    status: in_progress

  - id: auth-middleware
    summary: "Create Express middleware for route protection"
    spec: specs/auth-middleware.md
    workflow: default
    depends_on: [auth-service]
    priority: 3
    status: waiting
    waiting_on: auth-service

  - id: auth-refresh
    summary: "Implement token refresh rotation"
    spec: specs/auth-refresh.md
    workflow: default
    depends_on: [auth-service]
    priority: 2
    status: waiting
    waiting_on: auth-service

```

All tasks within a project execute sequentially, respecting the dependency order defined by `depends_on`. There is no track assignment — each project is its own execution context.

#### `task-tree.json` — Task Spawning Map

Built by the supervisor from `decisions.jsonl` across all projects.

```json
{
  "sessions": {
    "afk-2026-03-15": {
      "projects": {
        "auth-system": {
          "plan_version": 2,
          "tasks": [
            {
              "id": "auth-models",
              "source": "plan",
              "status": "done",
              "commit": "abc1234",
              "children": []
            },
            {
              "id": "auth-service",
              "source": "plan",
              "status": "done",
              "commit": "def5678",
              "children": [
                {
                  "id": "auth-session-migration",
                  "source": "replan-v2",
                  "status": "done",
                  "commit": "xyz9999",
                  "children": []
                }
              ]
            }
          ]
        }
                  "children": []
                }
              ]
            }
          ]
        }
      }
    }
  }
}
```

---

## 3. App Stack

### Phase 1: Core + CLI (week 1-3)

```
afk/
├── packages/
│   ├── core/                         # Pure TS, zero UI deps
│   │   ├── src/
│   │   │   ├── supervisor.ts         # Main daemon — heartbeat monitor + process mgr
│   │   │   ├── workflow-engine.ts    # Interprets workflow YAML, controls step transitions
│   │   │   ├── workflow-loader.ts    # Loads + validates workflow definitions
│   │   │   ├── consensus.ts          # Slot-based fan-out/fan-in for planning steps + synthesis
│   │   │   ├── executor.ts           # Spawns agent CLIs as sandboxed child processes
│   │   │   ├── git.ts                # Worktree lifecycle, stash, branch, diff
│   │   │   ├── heartbeat.ts          # File watcher for heartbeat.json files
│   │   │   ├── parser.ts             # Reads/writes all afk/ files (md + yaml + jsonl)
│   │   │   ├── graph-builder.ts      # Aggregates decisions.jsonl → task-tree.json + graph
│   │   │   ├── policy.ts             # Unified security policy evaluator (deny-wins)
│   │   │   ├── error-classifier.ts   # 5-class error taxonomy + loop detector
│   │   │   ├── context-budget.ts     # Pre-step context window estimation
│   │   │   ├── provider.ts           # CLI registry, model catalog, tier resolution
│   │   │   ├── quota.ts              # Quota backoff manager + probe logic
│   │   │   ├── linear-sync.ts        # Polls Linear, syncs ticket status bi-directionally
│   │   │   ├── input-processor.ts    # Triage: classifies raw input (task/prd/bug/research/vague)
│   │   │   ├── planner.ts            # PRD decomposition → dependency-ordered task graph
│   │   │   ├── re-planner.ts         # Mid-execution plan invalidation + re-planning + reconciliation
│   │   │   ├── project.ts            # Project creation and scaffolding (afk new)
│   │   │   ├── exploration.ts        # Exploration mode task generation
│   │   │   ├── memory.ts             # 5-layer memory read/write/injection
│   │   │   ├── repo-map.ts           # Tree-sitter structural index generation
│   │   │   ├── notifier.ts           # Notification interface (Telegram, future channels)
│   │   │   ├── commands.ts           # Command handler interface (Telegram, future channels)
│   │   │   ├── repair.ts             # Doctor + recovery + schema migration
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   └── cli/                          # Thin CLI wrapper over core
│       ├── src/
│       │   ├── index.ts              # Entry point + arg parser
│       │   ├── commands/
│       │   │   ├── start.ts          # afk start
│       │   │   ├── new.ts            # afk new <name> [--from <file>] [--template <t>]
│       │   │   ├── handoff.ts        # afk handoff <file> [--plan-only] [--workflow <w>]
│       │   │   ├── pause.ts          # afk pause [--project <name> | --all]
│       │   │   ├── resume.ts         # afk resume
│       │   │   ├── status.ts         # afk status — live dashboard in terminal
│       │   │   ├── report.ts         # afk report — morning summary
│       │   │   ├── adopt.ts          # afk adopt [--tasks auth-flow,token-refresh]
│       │   │   ├── drop.ts           # afk drop [--tasks exploration-*]
│       │   │   ├── add-task.ts       # afk add-task "fix login bug" [--spec ./spec.md]
│       │   │   ├── add-context.ts    # afk add-context ./research.md
│       │   │   ├── approve.ts        # afk approve <token> [--skip]
│       │   │   ├── deny.ts           # afk deny <token> --reason "rework X"
│       │   │   ├── mode.ts           # afk mode supervised [--project <name>]
│       │   │   ├── reset.ts          # afk reset — clean slate, archive current session
│       │   │   ├── archive.ts        # afk archive — move session to afk/archive
│       │   │   ├── graph.ts          # afk graph — print decision tree to terminal
│       │   │   ├── doctor.ts         # afk doctor [--fix]
│       │   │   ├── audit.ts          # afk audit [--fix] — security audit
│       │   │   ├── plan.ts           # afk plan — show/manage current plan
│       │   │   └── init.ts           # afk init — scaffold afk/ directory + auto-detect CLIs
│       │   └── tui/
│       │       └── status-view.ts    # blessed/ink live terminal dashboard
│       └── package.json
│
├── package.json                      # Workspace root
├── bun.lockb
└── tsconfig.json
```

**Runtime: Bun** — fast startup, native FS, child process support, compiles to single binary.

**Key dependencies:**
- `yaml` — config parsing
- `ink` or `blessed` — terminal UI for `afk status`
- `zod` — runtime validation of heartbeat/config/decisions/workflow schemas
- `diff` — for diff generation
- `tree-sitter` — repo-map structural indexing

### Phase 2: macOS App (week 4+)

```
packages/
└── app/                              # Tauri v2 application
    ├── src-tauri/
    │   ├── src/
    │   │   ├── main.rs               # Minimal — just spawns CLI commands
    │   │   ├── commands.rs           # Tauri command handlers → shell out to afk CLI
    │   │   └── watcher.rs            # Native FSEvents watcher for afk/ changes
    │   └── tauri.conf.json
    │
    ├── src/                          # React + Tailwind frontend
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── SessionDashboard.tsx   # Overview: projects, heartbeats, active tasks
    │   │   ├── ProjectCard.tsx          # Single project status with live heartbeat indicator
    │   │   ├── PlanView.tsx           # Current plan with dependency graph + task statuses
    │   │   ├── TaskQueue.tsx          # tasks.md rendered with drag-to-reorder
    │   │   ├── DecisionGraph.tsx      # Interactive DAG of decisions/pivots/task spawns
    │   │   ├── DecisionTimeline.tsx   # Chronological view of all decision events
    │   │   ├── TaskTree.tsx           # Tree view: task → subtasks → spawned tasks
    │   │   ├── ReviewRounds.tsx       # Review iteration history per task
    │   │   ├── ExplorationFindings.tsx# Bug/improvement proposals from exploration mode
    │   │   ├── MorningReport.tsx      # Aggregated report with adopt/drop controls
    │   │   ├── ContextInbox.tsx       # Drag-and-drop zone for new context files
    │   │   ├── LinearSync.tsx         # Linear ticket status mirror
    │   │   ├── GateApproval.tsx       # Human gate approval/deny controls
    │   │   ├── ReplanHistory.tsx      # Shows re-plan events with before/after diffs
    │   │   ├── ConsensusView.tsx      # Shows consensus step outputs + synthesis
    │   │   ├── Controls.tsx           # Start/pause/resume/reset/add-project/mode-switch
    │   │   └── MarkdownPreview.tsx    # Shared markdown renderer for all .md files
    │   │
    │   ├── hooks/
    │   │   ├── useFileWatcher.ts      # Subscribes to Tauri FS events for afk/
    │   │   ├── useSession.ts          # Session state from config.yaml
    │   │   └── useGraph.ts            # Parses decision graph for visualization
    │   │
    │   └── lib/
    │       ├── graph-layout.ts        # Dagre/ELK layout for decision graph
    │       └── diff.ts                # Diff rendering utilities
    │
    └── package.json
```

**Why Tauri v2 over Electron/Swift:**
- You know React/TS. Zero new language for the UI.
- Tauri v2 has native macOS integration (menu bar, notifications, FSEvents).
- The app is thin — it reads files and calls CLI commands. No heavy runtime needed.
- Binary size ~5MB vs Electron's ~150MB.

**Graph visualization:** Use `@dagrejs/dagre` for layout + custom React SVG rendering. The decision graph is small enough (dozens to low hundreds of nodes per session) that a simple DAG layout works perfectly. Each node type gets a distinct shape/color. Re-plan events show as highlighted transition points in the graph.

---

## 4. Execution Flow — Detailed

### 4.1 Session Startup

```
afk start
  │
  ├─ 1. Read config.yaml (repo) + merge with global (~/.afk/config.yaml)
  │     Resolve config layers: global defaults → repo overrides
  │
  ├─ 2. Load workflow definitions from afk/workflows/
  │     Validate all YAML against WorkflowSchema
  │
  ├─ 3. Detect local changes
  │     ├─ if stash: git stash push -m "afk-pre-session"
  │     ├─ if commit-wip: git commit -am "wip: pre-afk"
  │     └─ if fail: abort with error
  │
  ├─ 4. Generate repo-map.json (tree-sitter structural index)
  │
  ├─ 5. Create worktrees (one per project)
  │     └─ For each project: git worktree add ../.afk-worktrees/<project> -b afk/<project>
  │
  ├─ 6. Scaffold project directories
  │     └─ For each project: create afk/projects/<project>/ with heartbeat, progress
  │     └─ Register project → worktree → branch mapping in SQLite
  │
  ├─ 7. Sync Linear tickets (if enabled, respecting pickup_filter)
  │     └─ Pull tickets with "afk-ready" label → feed to input processor
  │
  ├─ 8. Process inbox
  │     └─ For each .md in afk/inbox/ → feed to input processor
  │
  ├─ 9. Run input processor → classify inputs → route to planner or direct task creation
  │     └─ PRDs → planner produces plan YAML per project
  │     └─ Simple inputs → direct spec creation + task registration
  │
  ├─ 10. Resolve providers for all workflow steps
  │      └─ For each step: resolve tier → preference order → check provider availability
  │
  ├─ 11. Load memory layers for injection
  │      └─ Read MEMORY.md, active-context.md, failure-gates.md
  │
  ├─ 12. Spawn agent processes (one per project, via workflow engine)
  │      └─ Each project starts at the workflow's entry step for its first task
  │
  └─ 13. Start supervisor loop
         └─ Heartbeat monitoring, Linear polling, inbox watching, provider status,
            dependency resolution, re-plan detection
```

### 4.1b Handoff Startup

```
afk handoff ./my-prd.md
  │
  ├─ 1. Copy PRD to afk/inbox/
  ├─ 2. Run input processor → classify as "prd"
  ├─ 3. Run planner (frontier tier) with PRD + memory + repo-map
  │     Planner produces: plan YAML + spec files for each task
  ├─ 4. Write plan to afk/projects/<project>/plan.yaml
  ├─ 5. Write specs to afk/context/specs/
  ├─ 6. Create project, assign tasks based on dependency ordering
  └─ 7. Start session (same as step 3+ in Session Startup above)

afk handoff ./my-prd.md --plan-only
  │
  └─ Stops after step 4. Shows the plan. Does not execute.
```

### 4.2 The Workflow Engine (Supervisor-Controlled)

The workflow engine replaces the hardcoded step sequence. It interprets workflow YAML definitions and controls transitions deterministically.

```
WORKFLOW ENGINE (per project, per task):

  1. Read workflow definition for this task
  2. Start at entry step (first step in workflow)
  3. Loop:
     a. Check human gates for current step
     b. If step has consensus config → run consensus (fan-out/fan-in)
        Otherwise → run single agent
     c. Read step_complete.json, validate against schema
     d. Resolve next step from workflow transitions + output status
     e. Check iteration limits
     f. Check for plan invalidation signals
     g. Transition to next step (or "done" to complete task)
  4. On task complete: commit, update plan status, check for waiting projects
  5. Pick next task from plan (if available), or enter exploration
```

**Default workflow execution (the standard loop):**

```
Phase: MAIN (while tasks in this project remain)
├─ 0. PREP
│     ├─ Supervisor writes step_input.json: step=prep, task context, memory injection
│     ├─ Supervisor spawns agent with steps/prep.md prompt
│     ├─ Agent: run full test suite, fix any existing failures
│     ├─ Agent: write step_complete.json with status + summary
│     └─ Supervisor reads completion, transitions to PICK
│
├─ 1. PICK TASK
│     ├─ Supervisor checks plan for next task in this project
│     ├─ If next task depends on incomplete work → set project to "waiting"
│     │     Project idles until dependency is committed earlier in this project
│     │     Supervisor unblocks when dependency completes
│     ├─ Agent: mark task as "in progress" 
│     ├─ Supervisor: if Linear-sourced, refetch ticket state (conflict resolution)
│     ├─ Agent: write decision: type=task_start
│     └─ Agent: write step_complete.json
│
├─ 2. ANALYZE (consensus mode if configured)
│     ├─ If consensus: supervisor spawns N agents (one per slot), each analyzing independently
│     │     Consensus outputs written to project/step-analyze-iter-M/
│     │     Synthesis agent merges all analyses into unified scope assessment
│     │     Enriched analysis provided to subsequent steps
│     ├─ If single: standard single-agent execution
│     ├─ Agent(s): load spec, examine relevant code guided by repo-map
│     ├─ Agent(s): write decision for each significant analysis conclusion
│     └─ Output: analysis + enriched plan for implementation
│
├─ 3. TEST PLAN
│     ├─ Agent: develop comprehensive test plan
│     ├─ Agent: write tests FIRST — expect them to fail
│     ├─ Agent: run tests, confirm failures
│     └─ Agent: write step_complete.json with test count and coverage targets
│
├─ 4. IMPLEMENT
│     ├─ Supervisor: check autonomy mode for before_implement gate
│     ├─ If gate hit → checkpoint, await approval (supervised/assisted mode)
│     ├─ Agent: write implementation (or fix review findings if reviewContext provided)
│     │     Uses enriched analysis from consensus ANALYZE step
│     ├─ Agent: write decision for each significant choice
│     ├─ If plan invalidation detected:
│     │     Agent writes decision: type=plan_invalidation with evidence
│     │     Supervisor triggers re-planning flow (see §8)
│     ├─ If sub-concern discovered:
│     │     Write decision: type=subtask_created with parent reference
│     │     Check autonomy mode for on_subtask_spawn gate
│     └─ Agent: write step_complete.json
│
├─ 5. CLEANUP
│     ├─ Agent: remove dead code from abandoned approaches
│     ├─ Agent: remove unused imports, orphaned helpers, leftover console.logs
│     ├─ Agent: remove commented-out code blocks
│     └─ Agent: write step_complete.json (what was removed, why)
│
├─ 6. SIMPLIFY
│     ├─ Agent: consolidate duplicated logic
│     ├─ Agent: simplify overly nested conditionals
│     ├─ Agent: extract unclear inline expressions into well-named variables
│     ├─ Agent: ensure consistent naming conventions
│     ├─ Does NOT change architecture or behavior — surface-level clarity only
│     └─ Agent: write step_complete.json (what was simplified, why)
│
├─ 7. REVIEW (supervisor enforces: minimum 2 rounds, max 5 for the review subloop)
│     ├─ Supervisor spawns review sub-agents per REVIEW_PERSONAS.md
│     │     Each persona: separate agent call, structured JSON findings
│     │     Personas run sequentially (shared worktree state)
│     ├─ Supervisor collects all findings → write to review-rounds.md
│     │
│     ├─ 7a. DISTILL (sub-step within review)
│     │     ├─ Separate agent (standard tier, fresh context) receives ALL persona findings
│     │     ├─ Deduplicates, removes false positives, resolves contradictions
│     │     ├─ Produces a clean, prioritized action list
│     │     └─ Output: distilled findings JSON (severity-ranked, actionable)
│     │
│     ├─ Supervisor determines verdict from distilled findings:
│     │     Any high-severity finding → needs-changes
│     ├─ If needs-changes:
│     │     Supervisor captures pre-fix git diff
│     │     Supervisor transitions to IMPLEMENT with distilled findings
│     │     Agent fixes → CLEANUP → SIMPLIFY → REVIEW again
│     │     After re-implementation, supervisor compares diffs
│     │     If diffs identical (Levenshtein < 5%) → agent stuck → try different provider or needs-input
│     ├─ If approved by all reviewers:
│     │     Check autonomy mode for on_review_verdict gate
│     │     Proceed to VALIDATE
│     ├─ If review round count >= max:
│     │     If full autonomy → advance anyway, flag for human review
│     │     If supervised/assisted → hit gate: on_review_cap_reached
│     └─ Supervisor writes heartbeat: step=reviewing, review_round=N
│
├─ 8. VALIDATE
│     ├─ Supervisor runs validation directly (not the agent):
│     │     Run: type checker, linter, compiler, bundle size check
│     │     Run: task-specific tests (must all pass)
│     │     Run: full test suite (regression check)
│     ├─ If failures: classify error (semantic → loop back to IMPLEMENT, deterministic → escalate)
│     ├─ Write test-coverage.md with per-module coverage
│     └─ Write heartbeat: step=validating, tests={passing, failing, coverage_pct}
│
├─ 9. COMMIT
│     ├─ Check autonomy mode for before_commit gate
│     ├─ If gate hit → checkpoint, await approval
│     ├─ Stage changes, commit with detailed message
│     │     Commit message format:
│     │     feat(auth): implement PKCE OAuth flow
│     │     
│     │     - Chose PKCE over implicit for native app security
│     │     - Used jose library for JWT validation after review feedback
│     │     - 23 tests, 91% coverage on auth module
│     │     - Review: 2 rounds, architect flagged missing rate limiting (fixed)
│     │     
│     │     Task: auth-flow
│     │     Plan: auth-system-plan (v1)
│     │     Project: auth-system
│     │     Session: afk-2026-03-15
│     │     Provider: claude/claude-opus-4
│     ├─ If Linear-sourced: update Linear status → "In Review"
│     ├─ Update plan: mark task as "completed" with committed_at timestamp
│     ├─ Unblock any projects waiting on this task
│     ├─ Regenerate repo-map.json (codebase changed)
│     └─ Write heartbeat: step=committing
│
├─ 10. ITERATION CHECK
│     ├─ Supervisor checks total step invocations for this task against max_task_iterations
│     ├─ If exceeded → mark task as needs-input, move to next task
│     └─ Otherwise → pick next task from plan
│
└─ 11. NEXT TASK → back to PICK
       If no more tasks in this project → exploration phase (if enabled)

Phase: EXPLORATION (when all assigned tasks complete)
├─ Check autonomy mode for before_exploration gate
├─ Write decision: type=phase_change, from=main, to=exploration
├─ Write heartbeat: phase=exploration
│
├─ Exploration sub-loop:
│   ├─ Scan codebase systematically (file by file, module by module)
│   ├─ For each finding:
│   │     ├─ Classify: bug | improvement | refactor | feature-suggestion
│   │     ├─ Assess severity/value: critical | high | medium | low
│   │     ├─ Write decision: type=exploration_finding
│   │     ├─ Write to exploration.md with full details
│   │     ├─ If bug (medium+ severity): implement fix in separate commit
│   │     │     Tag commit: [exploration] fix(module): description
│   │     ├─ If improvement/feature: write proposal only, do NOT implement
│   │     │     (human decides whether to promote to real task)
│   │     └─ Write heartbeat: step=exploring
│   │
│   └─ Continue until token budget exhausted
│
└─ WRAP-UP
    ├─ Write report.md — concise summary of everything done
    ├─ Write any unresolved TODOs to tasks.md under "Needs Input"
    ├─ Final heartbeat: step=done
    └─ Exit
```

### 4.3 Supervisor Monitoring Loop

```typescript
// Simplified supervisor logic
async function supervisorLoop(session: Session) {
  while (session.status === 'running') {
    
    // 1. Check heartbeats
    for (const project of session.projects) {
      const hb = readHeartbeat(project);
      const staleSec = (Date.now() - hb.timestamp) / 1000;
      
      if (staleSec > session.config.heartbeat.stall_threshold_seconds) {
        log(`Project ${project.id} stalled at step=${hb.step}, task=${hb.task_id}`);
        
        if (project.restarts >= session.config.heartbeat.max_restarts_per_project) {
          project.status = 'failed';
          log(`Project ${project.id} exceeded max restarts, marking failed`);
          continue;
        }
        
        await killProcess(project.pid);
        project.restarts++;
        await spawnAgent(project, { resumeFrom: hb.step, resumeTask: hb.task_id });
      }
    }
    
    // 2. Check for plan invalidation signals from any project
    for (const project of session.projects) {
      const invalidation = await checkPlanInvalidation(project);
      if (invalidation && project.plan.replanCount < session.config.planning.max_replans_per_session) {
        await triggerReplan(session, project, invalidation);
      }
    }
    
    // 3. Check task dependency resolution within each project
    for (const project of session.projects) {
      if (project.status === 'waiting') {
        const waitingOn = project.currentTask.waiting_on;
        if (project.plan.isTaskCompleted(waitingOn)) {
          project.status = 'running';
          log(`Project ${project.id} unblocked — ${waitingOn} is committed`);
        }
      }
    }
    
    // 4. Rebuild decision graph from all projects' decisions.jsonl
    await rebuildGraph(session);
    
    // 5. Sync Linear (if interval elapsed)
    if (session.config.linear.enabled && linearSyncDue()) {
      const newTickets = await syncLinear(session);
      if (newTickets.length > 0) {
        await inputProcessor.enqueue(newTickets.map(t => ({ source: 'linear', data: t })));
      }
    }
    
    // 6. Check inbox for new context files
    const newFiles = await checkInbox(session);
    for (const file of newFiles) {
      await inputProcessor.enqueue([{ source: 'inbox', data: file }]);
      moveToProcessed(file);
    }
    
    // 7. Process input queue (runs in parallel, non-blocking)
    await inputProcessor.processReady();
    
    // 8. Check provider status, attempt auto-recovery for fallback providers
    await checkProviderRecovery(session);
    
    // 9. Check if all projects are done
    if (session.projects.every(t => t.status === 'done' || t.status === 'failed')) {
      session.status = 'reviewing';
      await generateMorningReport(session);
      await extractLearnings(session);  // Session-end memory ritual
      break;
    }
    
    await sleep(session.config.heartbeat.interval_seconds * 1000);
  }
}
```

### 4.4 Sandbox Enforcement

The sandbox is enforced via the unified security policy evaluated at every operation:

**Level 1: Policy evaluation** — Every command, path access, and network request is checked against all policy layers (global, repo, session, step). Deny always wins.

**Level 2: Wrapper script** — The agent is spawned not directly via the CLI but via a wrapper:

```bash
#!/bin/bash
# afk-sandbox.sh — wraps the agent CLI
export AFK_TRACK_DIR="$1"
export AFK_SANDBOX=1

# Restricted PATH — no system tools that could escape
export PATH="/usr/bin:/usr/local/bin:$AFK_TRACK_DIR/node_modules/.bin"

# cd into worktree — agent starts here, cannot escape
cd "$AFK_TRACK_DIR"

# Run the agent with confined cwd
$AGENT_BINARY $AGENT_FLAGS \
  --prompt "Load @afk/context/steps/$STEP.md and begin." \
  --cwd "$AFK_TRACK_DIR"
```

**Level 3: In-context rules** — `SANDBOX_RULES.md` is loaded as part of each step prompt. Human-readable constraints the agent follows. This is defense-in-depth — the policy evaluator enforces mechanically, the rules reinforce in-context.

---

## 5. Autonomy Modes — Variable Human-in-the-Loop

### The Pattern

AFK supports three runtime autonomy modes, selectable per session and switchable mid-session via CLI or Telegram. Full autonomy overnight, supervised execution during the day.

### Implementation

Each human gate is a **resume token checkpoint**. When the supervisor hits a gate, it:

1. Serializes full workflow state to `the project's checkpoint file` — current step, task context, accumulated artifacts, review rounds, and the specific gate that triggered.
2. Sets project status to `awaiting_approval` with a `gate_type` field.
3. Sends notification (Telegram, desktop, or both) with a one-line summary and the approval command.
4. Returns a `resumeToken` — a deterministic hash of `(session_id, project_id, step, gate_type, timestamp)`.

Approval commands:

```bash
afk approve <token>                    # Resume from checkpoint
afk approve <token> --skip             # Skip the gated step
afk approve --project auth-system                  # Approve current gate on track 2
afk deny <token> --reason "rework X"   # Deny with feedback, loop back
```

Mid-session mode switching:

```bash
afk mode supervised                    # Switch all projects
afk mode full --project auth-system                # Switch only track 1
```

Mode changes take effect at the next transition boundary — never mid-step.

### Gate Types

Gates are defined per workflow, not hardcoded. The `default` workflow defines:

- **`before_implement`** (assisted only) — approve plan before implementation begins
- **`before_commit`** (supervised, assisted) — review code before committing
- **`on_review_cap_reached`** (supervised, assisted) — review loop exceeded max rounds
- **`on_subtask_spawn`** (supervised, assisted) — new task discovered mid-implementation
- **`on_replan`** (supervised, assisted) — plan invalidation detected, re-plan proposed

Custom workflows can define their own gate types.

### Why Three Modes

The three-mode design maps to trust calibration: start in assisted for a new repo, graduate to supervised, eventually run full autonomy for proven repos. The same user wants different behavior at 2am vs 2pm.

---

## 6. Decision Graph & Timeline

### Data Flow

```
Agent writes decisions.jsonl (append-only, per project)
  │
  ▼
Supervisor aggregates all projects every heartbeat cycle
  │
  ▼
graph-builder.ts produces:
  ├── session-<date>.json  — full graph with nodes + edges
  └── task-tree.json       — hierarchical task spawning view
  │
  ▼
UI renders two views:
  ├── DecisionGraph.tsx    — DAG: nodes are events, edges are causal links
  └── DecisionTimeline.tsx — Chronological list grouped by project
```

### Graph Node Types

| Type | Shape | Color | Description |
|------|-------|-------|-------------|
| `task_start` | Rectangle | Blue | A task was picked from the plan |
| `decision` | Diamond | Amber | A significant technical choice was made |
| `pivot` | Diamond + arrow | Red | Agent changed approach mid-task |
| `review` | Circle | Green/Red | Review round (green=approved, red=needs-changes) |
| `subtask_created` | Rectangle (dashed) | Purple | New task spawned from current work |
| `task_done` | Rectangle (filled) | Green | Task completed with commit hash |
| `phase_change` | Hexagon | Gray | Transition from main → exploration |
| `exploration_finding` | Triangle | Orange | Bug/improvement found during exploration |
| `test_milestone` | Shield | Teal | Tests passing/coverage threshold reached |
| `quota_hit` | Pause icon | Yellow | API quota hit (shows wait duration) |
| `gate_reached` | Lock icon | Blue | Human gate checkpoint (shows approval status) |
| `plan_invalidation` | Warning icon | Red | Evidence that plan needs updating |
| `replan` | Refresh icon | Purple | Plan was updated (shows version change) |

### Morning Review: What You See

The UI shows a single screen with:

1. **Plan summary**: "PRD: auth-system. Plan v2 (1 re-plan). 5 tasks: 3 done, 1 in progress, 1 waiting."

2. **Task tree** (left panel): Expandable tree showing the dependency graph from the plan, with status badges and commit hashes. Click to expand and see the commit diff.

3. **Decision timeline** (center): Scrollable timeline showing all events across all projects, color-coded by project. Filter by project, by task, by event type. Re-plan events are prominently highlighted. Each node is clickable → shows the full reasoning and alternatives considered.

4. **Action panel** (right): For each task/commit:
   - **Adopt** — merge this commit into your branch
   - **Drop** — discard
   - **Review** — open diff in your editor
   - For exploration findings: **Promote to task** or **Dismiss**

---

## 7. Linear Integration

### Architecture — Linear as a Dispatch Surface

The Linear polling daemon is valuable as a **mobile-first task creation interface**. The workflow — groom an idea with Claude on iOS, create a ticket, local AFK picks it up — is AFK's highest-leverage feature.

```
You (iOS Claude) → Linear ticket → AFK supervisor polls → input processor → planner → agent picks up
You (Linear app) → Linear ticket → AFK supervisor polls → input processor → planner → agent picks up
You (CLI)        → afk handoff   → planner → agent picks up
You (CLI)        → afk add-task  → tasks.md → agent picks up (bypasses planner)
```

### Sync Protocol

```
Every 5 minutes (configurable):
  │
  ├─ Pull tickets from Linear project
  │   Filter: has "afk-ready" label
  │   Filter: not labelled "draft" or "blocked"
  │   Filter: status NOT in [Done, Cancelled]
  │
  ├─ For each new/changed ticket:
  │   ├─ If not in tasks.md → feed to input processor
  │   │     Input processor classifies → routes to planner or direct task creation
  │   ├─ If status changed in Linear → update tasks.md
  │   └─ If ticket has new comments → append to spec context
  │
  ├─ For each in-progress task:
  │   ├─ If agent started working → Linear status = "In Progress"
  │   ├─ If agent completed review → Linear status = "In Review"
  │   └─ If agent committed → Linear status = "Done"
  │
  └─ Write sync state to afk/inbox/linear-sync.json
```

### Conflict Resolution — "Always Refetch, Never Assume"

Before every phase transition, the supervisor refetches the ticket state from Linear. If the ticket was moved to a terminal state (Done, Cancelled) by a human while the agent was working, the supervisor kills the project's current task and moves to the next one. No complex locking needed.

### Label-Based Pickup Filtering

Don't auto-pick up every ticket. Use an `afk-ready` label so you explicitly tag tickets for overnight runs. Bulk-tag before going AFK: "these 5 are ready, go."

---

## 8. Input Processing, Planning, and Re-Planning

### The Problem

Raw input arrives from many sources: a one-line Telegram message, a Linear ticket with a paragraph description, a full PRD from a research session, a file dropped into the inbox, a CLI command. The workflow engine assumes structured specs exist and tasks are dependency-ordered. Something needs to bridge the gap — and it needs to handle everything from vague one-liners to complex multi-feature PRDs.

### Architecture — Three Components

```
Input Sources:
  Telegram /task "message"  ─→ Input Processor → triage
  Linear ticket (new)       ─→ Input Processor → triage
  Inbox .md file drop       ─→ Input Processor → triage
  CLI: afk add-task "desc"  ─→ Input Processor → triage
  CLI: afk handoff prd.md   ─→ Input Processor → triage → Planner

  Already has spec?         ─→ skip processing, just add to tasks.md

Triage routes to:
  "task"     → direct spec creation + tasks.md entry
  "bug"      → spec creation with bugfix workflow assignment
  "prd"      → Planner (full PRD decomposition)
  "research" → Planner (extract actionable items)
  "vague"    → needs-input, notify user

Planner produces:
  Plan YAML (dependency-ordered task graph) + spec file per task

Re-Planner (triggered mid-execution):
  Updated plan YAML + reconciliation instructions
```

### Input Processor (Triage)

For each raw input, the input processor runs a short agent call (standard tier, fast timeout) that classifies:

- **task**: Clear, self-contained task with enough detail for a spec. Route to direct spec creation.
- **bug**: Bug report — create spec, assign bugfix workflow.
- **prd**: Complex document needing decomposition — full PRD, multi-feature request, research output. Route to planner.
- **research**: Information-gathering request — route to planner with research workflow.
- **vague**: Not enough information to act on. Mark as needs-input, notify user.

### Planner (PRD Decomposition)

The planner is an agent call (frontier tier) that receives:
- The full PRD/input document
- The repo's MEMORY.md and active-context.md (so it knows existing patterns)
- The repo-map (so it knows existing code structure)
- The decision-index (so it knows past decisions)

It produces:
- A plan YAML file with dependency-ordered tasks
- A spec file per task (written to `afk/context/specs/`)
- Initial task ordering within the project

The planner should be conservative about splitting — too many tiny tasks create coordination overhead. A good heuristic: each task should be completable in one IMPLEMENT pass (roughly 1-2 files of significant change).

### What the Input Processor Does Not Do

- It does not block the main loop. It runs in parallel. If a project finishes all available tasks while new inputs are being processed, the project enters exploration mode or waits.
- It does not modify existing specs. If new input affects an existing task, it writes a diff proposal to `afk/inbox/proposals/<task-id>-diff.md` for your review.
- It does not set task priority within a plan. The planner determines dependency ordering; you reorder within tiers.

### Automatic Re-Planning

This is the most architecturally significant feature. When mid-execution evidence proves the plan is wrong, AFK automatically re-plans with accumulated context while preserving completed work.

**Trigger Conditions:**

1. **Agent signals plan invalidation**: During IMPLEMENT or ANALYZE, the agent discovers that assumptions in the spec are wrong (e.g., "the API I was told to integrate with doesn't exist" or "the database schema in the spec doesn't match reality"). The agent writes a `plan_invalidation` decision with evidence.

2. **Review identifies scope creep**: The REVIEW step's architect persona identifies that the implementation requires changes outside the task's spec boundary. Rather than silently expanding scope, this triggers re-planning.

3. **Dependency contradiction**: Project commits task-A, and when the next task starts its dependent task-B, the analysis step discovers that task-A's implementation contradicts task-B's spec assumptions.

4. **Repeated implementation failure**: After N failed IMPLEMENT→REVIEW loops on the same task, the supervisor concludes the task spec itself is flawed, not just the implementation.

**Re-Plan Flow:**

```
Trigger detected (plan_invalidation decision with evidence)
  ↓
Supervisor pauses the affected project
  ↓
Re-planner agent (frontier tier) receives:
  - Original PRD
  - Original plan (with completion status per task)
  - Evidence of why plan broke (the invalidation decision + context)
  - Git log of all commits in this project's branch
  - Current codebase state (repo-map, recent commits)
  - Memory + decision-index
  ↓
Re-planner produces:
  - Updated plan YAML (incremented version)
  - Revert instructions (critical new capability):
    - Tasks to REVERT — commits that built on wrong assumptions
      e.g., "revert auth-middleware (commit abc1234) — built on wrong session schema"
    - Revert depth — how far back to reset
  - Reconciliation instructions:
    - Tasks to keep as-is (committed and still valid)
    - Tasks to redo (revert + re-implement with corrected spec)
    - Tasks to add (newly discovered work)
    - Tasks to remove (no longer needed)
  ↓
Supervisor applies revert:
  - For each task marked for revert: git revert <commit> in project worktree
  - Update task status in plan: "reverted"
  - Update task status in SQLite
  - This resets the worktree to a known-good state
  ↓
Supervisor applies reconciliation:
  - Reverted tasks: re-queued with updated specs, start from ANALYZE
  - Kept tasks: no change
  - Waiting tasks: update specs, re-evaluate dependencies
  - New tasks: add to plan
  ↓
Write decision: type=replan with before/after summary + revert details
  ↓
Resume execution with updated plan from the stable point
```

The revert capability is essential. Building fixes on top of a wrong foundation creates compounding errors — each subsequent task inherits the bad assumptions. It is always better to revert to a known-good state and rebuild from there with correct understanding. The re-planner explicitly reasons about which commits are tainted and which are still valid.

**Guardrails:**

- **Re-plan budget**: Maximum N re-plans per session (default: 3). Prevents infinite re-planning loops.
- **Revert safety**: Reverts use `git revert` (creates a new commit that undoes the changes), not `git reset` (which rewrites history). The full history is always preserved for debugging.
- **Evidence requirement**: Re-planning requires a concrete `plan_invalidation` decision with evidence. "I think the plan might be wrong" is not sufficient — "the spec says to use API X but API X returns 404" is.
- **Human gate option**: In supervised/assisted mode, re-planning (especially reverts) can require approval (`on_replan` gate). In full autonomy, it proceeds automatically but logs prominently.

### Configuration

```yaml
# afk/config.yaml
planning:
  planner_tier: frontier
  planner_timeout_seconds: 300
  max_tasks_per_plan: 20
  max_replans_per_session: 3
  auto_replan: true

intake:
  parse_tier: standard
  parse_timeout_seconds: 120
  auto_decompose: true
  max_tasks_per_input: 5
  needs_input_threshold: low      # low = aggressive (try to make a spec from anything)
                                  # high = conservative (bounce anything ambiguous)
```

### How Input Processing Connects to Each Source

| Source | Trigger | Input Format | Behavior |
|--------|---------|-------------|----------|
| **CLI: handoff** | `afk handoff <file>` | PRD / research doc | Classify → planner → plan + specs + execution |
| **Linear** | Supervisor poll finds new ticket with `afk-ready` label | Ticket title + description + comments | Classify → decompose if complex → spec(s) + tasks.md |
| **Telegram** | `/task "description"` command | Short text message | Classify → spec + tasks.md (or needs-input if too vague) |
| **Inbox** | File dropped in `afk/inbox/` | Markdown document | Classify → planner if PRD-like, else direct spec creation |
| **CLI: add-task** | `afk add-task "desc" [--spec file.md]` | Description + optional spec file | If spec provided → skip processing, just add to tasks.md. If no spec → classify as task or vague |

---

## 9. Isolation & Cherry-Picking

### Everything Is a Commit, Everything Is Tagged

The mapping: **1 project = 1 worktree = 1 branch = N sequential commits**. When a project finishes task A and moves to task B, it commits task A on its branch, then starts task B in the same worktree. Task B sees task A's changes. Each project produces a clean branch that you merge or discard as a unit.

```
branch: afk/auth-system
  ├── commit: feat(auth): create database models              [task:auth-models]
  ├── commit: feat(auth): implement PKCE OAuth service        [task:auth-service]
  ├── commit: feat(auth): add route protection middleware     [task:auth-middleware]
  └── commit: [exploration] fix(sessions): race condition     [exploration:bug]

branch: afk/payment-api
  ├── commit: feat(payments): implement Stripe integration    [task:stripe-setup]
  └── commit: feat(payments): add webhook handlers            [task:webhooks]
```

When running multiple projects on the same repo, each branch is isolated. You merge them independently — `afk/auth-system` and `afk/payment-api` are separate PRs.

### Morning Review CLI

```bash
afk report                                    # see what happened
afk plan                                      # show current plan status
afk graph                                     # print decision tree
afk adopt --project auth-system               # merge the whole project branch
afk adopt --project auth-system --tasks auth-models,auth-service  # cherry-pick specific commits
afk drop --project payment-api                # discard entire project branch
afk archive                                   # clean up worktrees, archive session
```

`afk adopt` does:
1. Cherry-pick the selected commits onto your current branch (or merge the entire project branch)
2. Run the full test suite to verify
3. If conflicts: pause and show you exactly what conflicts
4. Update plan status and Linear status

`afk archive` does:
1. Move session runtime state to `afk/archive/<session-name>/`
2. Remove worktrees: `git worktree remove ...` (robust against orphaned/locked worktrees)
3. Clean up branches (optionally): `git branch -D afk/*`
4. Reset `config.yaml` status to `idle`

---

## 10. Workflow Engine

### The Problem with Prompt-Driven Loops

The original AGENT_LOOP.md approach puts the agent in charge of its own loop: pick task, write tests, implement, review, commit, repeat. This is fragile. The agent can skip steps, miscount review rounds, enter infinite retry loops, or claim it ran tests without actually executing them. Every flow control decision delegated to the LLM is a failure mode.

The solution: **LLMs do creative work, code handles plumbing.**

### Supervisor-Owned, Workflow-Driven State Machine

The supervisor (not the agent) owns the loop. Each project runs a state machine driven by the task's assigned workflow definition:

```
DEFAULT WORKFLOW:
PREP → PICK → ANALYZE → TEST_PLAN → IMPLEMENT → CLEANUP → SIMPLIFY → REVIEW (+ DISTILL) → VALIDATE → COMMIT → NEXT TASK
                                         ↑                                 │
                                         └─────────────────────────────────┘ (needs-changes)

BUGFIX WORKFLOW:
PREP → IMPLEMENT → REVIEW (+ DISTILL) → VALIDATE → COMMIT

RESEARCH WORKFLOW:
ANALYZE → REPORT
```

The supervisor reads the workflow YAML, resolves transitions, and controls the loop. The agent handles the work within each step.

### The Step Contract

Every step follows the same contract, enforced by the supervisor:

```typescript
interface StepExecution {
  // SUPERVISOR WRITES (before spawning agent)
  input: {
    step: StepName;
    task: TaskContext;
    provider: ResolvedModel;           // CLI binary + model + flags for this step
    memory: MemoryInjection;           // MEMORY.md + active-context.md + relevant gates
    repoMap: string;                   // Structural code index
    previousStepOutput?: StepOutput;   // JSON piped from prior step
    reviewContext?: ReviewContext;      // For IMPLEMENT after review: findings to address
    consensusAnalysis?: string;        // Enriched analysis from consensus ANALYZE step
    autonomyMode: AutonomyMode;        // Current mode for gate checking
    planContext?: PlanContext;          // Current plan, task dependencies, completed tasks
  };

  // AGENT WRITES (on completion)
  output: {
    status: 'complete' | 'failed' | 'needs_input' | 'checkpoint';
    summary: string;
    artifacts: string[];
    discoveredSubtasks?: SubTask[];
    reviewVerdict?: ReviewVerdict;
    testResults?: TestResults;
    planInvalidation?: PlanInvalidation;  // Evidence that plan needs updating
    durationMs: number;
  };
}
```

The supervisor reads `step_complete.json`, validates against Zod schema, and makes the transition. The agent NEVER decides what step comes next.

### Transition Logic

The workflow engine resolves transitions from the workflow YAML definition:

```typescript
function resolveTransition(
  workflow: WorkflowDef,
  currentStep: string,
  output: StepOutput,
  state: ProjectState
): string {
  // Per-task iteration cap — prevents unbounded token burn
  if (state.taskIterations >= workflow.limits.max_task_iterations) {
    return 'needs_input';
  }

  const stepDef = workflow.steps[currentStep];
  const next = stepDef.next;

  // Simple transition: next is a string
  if (typeof next === 'string') return next;

  // Conditional transition: next is a record
  // e.g., { approved: 'validate', needs_changes: 'implement' }
  if (output.reviewVerdict === 'approved') return next['approved'];
  if (output.reviewVerdict === 'needs_changes') return next['needs_changes'];
  if (output.testResults?.allPassing) return next['pass'];
  return next['fail'] ?? 'needs_input';
}
```

### Consensus Integration

When a step has a `consensus` block in the workflow definition, the workflow engine delegates to the consensus runner instead of the single-agent step runner:

```typescript
// Inside the workflow engine's step execution
if (stepDef.consensus) {
  result = await consensusRunner.run(step, stepDef, taskId, projectId);
} else {
  result = await stepRunner.run(step, stepDef, taskId, projectId);
}
```

### Custom Workflow Example

```yaml
# afk/workflows/bugfix.yaml
name: bugfix
description: Quick fix workflow — skip analysis and test planning

steps:
  prep:
    tier: standard
    next: implement

  implement:
    tier: frontier
    next: review
    on_review_feedback: implement

  review:
    tier: standard
    personas: [code-expert]
    next: distill

  distill:
    tier: standard
    next:
      approved: validate
      needs_changes: implement

  validate:
    tier: fast
    runner: supervisor
    next:
      pass: commit
      fail: implement

  commit:
    tier: fast
    next: done

limits:
  max_review_rounds: 3
  max_task_iterations: 8
```

### Diff Check Between Review Loops

When the distill step returns `needs_changes` and loops to IMPLEMENT, the supervisor captures a git diff before and after. If diffs are identical (Levenshtein < 5%), the agent is stuck. Action: try a different provider for IMPLEMENT, or mark `needs_input`.

### Step-Specific Prompts

Each step gets a focused prompt:

```
afk/context/steps/
├── prep.md              # "Run the test suite, fix failures"
├── pick.md              # "Read tasks.md, claim the next task"
├── analyze.md           # "Load the spec, examine the code"
├── test_plan.md         # "Write tests for this spec, expect failures"
├── implement.md         # "Implement the feature to make tests pass"
├── cleanup.md           # "Remove dead code, unused imports, orphaned helpers"
├── simplify.md          # "Consolidate duplication, simplify complexity, clarify naming"
├── review.md            # "Review this diff against these criteria"
├── distill.md           # "Deduplicate, validate, and prioritize review findings"
├── validate.md          # "Run typecheck, lint, tests, verify"
├── commit.md            # "Stage, commit with this message format"
└── explore.md           # "Scan the codebase for issues"
```

Each prompt is small (50-100 lines), self-contained, and focused. The agent loads only the prompt for its current step plus the shared context. This reduces context window usage and makes each step's instructions unambiguous.

---

## 11. Consensus Mode

### Core Principle: Consensus for Understanding, Single Agent for Execution

Consensus mode is for **planning, scoping, and analysis steps** — where multiple perspectives on *what to do* improve the outcome. Implementation uses the single most capable model available.

Different models notice different things: one catches an architectural concern, another identifies a missing edge case, a third suggests a simpler approach. The synthesis step merges these perspectives into a richer plan than any single model would produce.

### When to Use Consensus

Good consensus candidates: ANALYZE (different models notice different architectural concerns), scope assessment within the planner (different models catch different edge cases), REVIEW (already multi-persona — consensus is a natural extension).

NOT for consensus: IMPLEMENT, CLEANUP, SIMPLIFY, COMMIT, VALIDATE. These are execution steps where one capable agent with a good plan is sufficient.

### Execution Model

When a step has a `consensus` block, the workflow engine:

1. **Fill slots**: The supervisor fills N slots with available providers, respecting the preference order and accounting for quota state. If a preferred provider is unavailable, the slot is filled by a fallback provider.

2. **Fan-out**: Spawns one agent per slot. Each gets identical input (same `step_input.json` content, same prompt). Each writes its output as a planning/analysis document — NOT code.

3. **Collect**: Waits for all agents to complete (or timeout individually). Each produces its own `step_complete.json` containing analysis, findings, or scope assessment.

4. **Synthesize**: Spawns a synthesis agent (frontier tier) with ALL outputs in context. The synthesis agent evaluates all perspectives and produces a unified planning artifact.

5. **Continue**: The workflow engine uses the synthesis output as the step's result and transitions normally. The next step receives a richer, multi-perspective analysis.

Because consensus operates on documents (plans, analyses, findings) rather than code, there is no worktree isolation problem. All consensus agents share the same read-only view of the codebase.

### Slot-Based Provider Assignment with Quota Failover

Consensus has a **slot count**, not a fixed provider list. If a provider hits quota, its slot gets filled by the next available provider at the appropriate tier.

```yaml
consensus:
  slots: 3
  preferred_providers: [claude, codex, gemini]
  fallback_providers: [copilot]
  synthesis_tier: frontier
  timeout_per_slot_seconds: 300
```

Runtime behavior: the supervisor fills slots in preference order. If gemini hits quota mid-session, its slot gets reassigned to copilot (or claude at a lower tier). The consensus result is always "N perspectives" — the provider composition is flexible. This integrates with the existing quota backoff and provider failover infrastructure.

### File Layout

```
afk/projects/auth-system/consensus/step-analyze-iter-1/
├── claude-output.json           # Claude's analysis
├── codex-output.json            # Codex's analysis
├── gemini-output.json           # Gemini's analysis
└── synthesis.json               # Merged analysis (fed to IMPLEMENT)
```

---

## 12. Error Classification and Loop Prevention

### The Core Principle: Errors Have Types, Types Determine Retry Policy

Treating all errors as transient causes infinite retry loops. AFK classifies errors at the runtime level.

### Error Taxonomy

```typescript
enum ErrorClass {
  DETERMINISTIC = 'deterministic',
  // Missing parameter, type mismatch, file not found, schema validation,
  // permission denied, command not found, syntax error
  // → NEVER retry. Same input = same error.

  TRANSIENT = 'transient',
  // Network timeout, API 500/502/503, connection reset
  // → Retry with backoff.

  SEMANTIC = 'semantic',
  // Test failures, lint errors, type errors, review rejection
  // → Retry with different approach (loop back to previous step).

  QUOTA = 'quota',
  // API quota hit, token budget exceeded, rate limit
  // → Pause and probe (existing quota recovery mechanism).

  FATAL = 'fatal',
  // Git corruption, worktree missing, config invalid,
  // context overflow after compaction
  // → Abort project, escalate immediately.
}
```

### Retry Policy Per Class

```typescript
const RETRY_POLICIES: Record<ErrorClass, RetryPolicy> = {
  deterministic: {
    maxRetries: 0,
    action: 'escalate',
    injectHint: true,
  },
  transient: {
    maxRetries: 3,
    backoff: { initial: 5000, multiplier: 2, max: 60000 },
    action: 'retry',
  },
  semantic: {
    maxRetries: 2,
    action: 'loop_back',
    requireDiffCheck: true,
  },
  quota: {
    maxRetries: 0,
    action: 'quota_pause',
  },
  fatal: {
    maxRetries: 0,
    action: 'abort_project',
  },
};
```

### Loop Detection — The LoopDetector

Sliding-window detector that catches loops the error classifier misses:

```typescript
class LoopDetector {
  private window: ToolCallFingerprint[] = [];
  private readonly maxWindow = 20;
  private readonly maxIdenticalCalls = 2;
  private readonly maxToolFailures = 5;

  addCall(call: ToolCallFingerprint): LoopVerdict {
    this.window.push(call);
    if (this.window.length > this.maxWindow) this.window.shift();

    const identical = this.window.filter(c =>
      c.tool === call.tool && c.argsHash === call.argsHash && c.errorClass === call.errorClass
    );
    if (identical.length > this.maxIdenticalCalls) {
      return { stuck: true, reason: 'identical_failing_calls', count: identical.length };
    }

    const failures = this.window.filter(c => c.errorClass);
    if (failures.length > this.maxToolFailures) {
      return { stuck: true, reason: 'excessive_failures', count: failures.length };
    }

    if (this.detectPingPong()) {
      return { stuck: true, reason: 'ping_pong_pattern' };
    }

    return { stuck: false };
  }
}
```

When triggered: write `stuck.json` to the project directory, notify, and either pause (supervised/assisted) or mark task as `needs-input` and move on (full autonomy).

---

## 13. Context Window Management

### AFK's Defense: State Lives in Files, Not Context

Each step starts with a fresh context (step prompt + relevant files). This makes AFK inherently less vulnerable than single-conversation tools. But active management is still needed.

### Pre-Step Context Budget Estimation

Before spawning a step's agent, the supervisor estimates the context requirement:

```typescript
interface ContextBudget {
  stepPrompt: number;
  taskContext: number;
  memoryInjection: number;
  repoMap: number;
  consensusAnalysis: number;    // Enriched analysis from consensus step (if present)
  safetyMargin: number;
  total: number;
  modelLimit: number;
  fits: boolean;
}
```

If estimated budget exceeds 80% of context window:

1. **Trim selectively**: Remove low-priority memory, reduce repo map, summarize long specs.
2. **Split the step**: Break large IMPLEMENT into sub-steps (module A, then module B).
3. **Upgrade the tier**: If assigned tier is `fast` but context needs more, temporarily use `standard`.

### Mid-Step Context Monitoring

The heartbeat file includes `tokens_used`. At 80% of model limit, the supervisor injects a flush instruction. If the agent writes a checkpoint, the supervisor can restart the step with reduced context.

### Hard Kill on Context Overflow

If the agent crashes from context overflow, the supervisor reads partial `step_complete.json` or `progress.md`, and restarts the step with reduced context. If it overflows again, mark task as `needs-input` with reason "task too large for available context."

---

## 14. Intra-Project Sub-Agents

### Model Tiering Within a Project

Not every step needs the most expensive model. The supervisor resolves the model per step using neutral tiers:

| Step | Default Tier | Rationale |
|------|-------------|-----------|
| PREP | standard | Running test suite, fixing obvious failures |
| PICK | fast | Reading tasks.md, selecting next task (trivial) |
| ANALYZE | frontier | Understanding spec, architectural analysis |
| TEST_PLAN | standard | Writing tests from a clear spec |
| IMPLEMENT | frontier | Core creative work, needs best reasoning |
| CLEANUP | standard | Removing dead code, unused imports (structured, checklist-driven) |
| SIMPLIFY | standard | Consolidating duplication, clarifying naming (needs judgment) |
| REVIEW | standard | Reviewing against checklists (structured task) |
| DISTILL | standard | Deduplicating and validating review findings |
| VALIDATE | fast | Running commands, checking output (mechanical) |
| COMMIT | fast | Formatting commit message (template-driven) |
| EXPLORE | standard | Scanning code, finding patterns (breadth over depth) |

Tiers resolve to concrete models via the model catalog (see §15).

### Review Sub-Agent Architecture

The REVIEW step spawns sub-agents — one per review persona. Each persona gets:
- Its own system prompt (from REVIEW_PERSONAS.md)
- The diff to review
- The relevant documentation section (from ROUTER.md)
- A standard tier model

Each persona runs as a separate sub-agent call, producing structured JSON findings:

```json
{
  "persona": "architect",
  "verdict": "needs_changes",
  "findings": [
    {
      "severity": "high",
      "file": "src/auth/oauth.ts",
      "line": 42,
      "issue": "Direct database access instead of service layer",
      "suggestion": "Use AuthService.validateToken()"
    }
  ],
  "approved_aspects": ["scope compliance", "dependency choices"]
}
```

After all personas complete, the **DISTILL** sub-step runs: a separate agent (standard tier, fresh context) receives ALL findings from all personas and produces a clean, deduplicated, prioritized action list. DISTILL catches contradictory findings, removes false positives, consolidates overlapping issues, and ranks by severity.

The supervisor combines the distilled verdict deterministically: any remaining high-severity finding → `needs_changes`. When looping to IMPLEMENT, the distilled findings are provided via reviewContext in step_input.json.

### Shared Context Within a Project

Sub-agents within a project share context through the project's file directory:
- `progress.md` — what's been done so far (read by every step)
- `decisions.jsonl` — full decision trail
- The working tree itself — the REVIEW step reads what IMPLEMENT wrote
- `step_input.json` / `step_complete.json` — the handoff protocol between steps
- Consensus outputs (when available) — enriched analysis from the consensus directory

Sub-agents do NOT share an LLM conversation history. Each step starts with a fresh context (step prompt + relevant files). This prevents context window exhaustion and forces each step to work from artifacts rather than conversation memory.

---

## 15. Multi-Provider CLI Routing

### Core Principle: AFK Spawns Local CLIs, Not APIs

AFK doesn't call provider APIs. It spawns `claude`, `codex`, `gemini`, `copilot` as child processes. The CLIs handle their own authentication. AFK needs to know which binaries are installed, how to invoke them, and how to detect their error/quota patterns from stdout/stderr.

### Configuration (`~/.afk/config.yaml`)

> **Note**: AFK never handles API keys — the CLIs manage their own auth via user subscriptions.

```yaml
providers:
  claude:
    binary: claude
    invoke: "claude -p"
    flags:
      system_prompt: "--append-system-prompt"
      output_format: "--output-format json"
      auto_approve: "--dangerously-skip-permissions"
      resume: "--resume"
      add_dir: "--add-dir"
    quota_patterns:
      - "rate limit"
      - "429"
      - "quota exceeded"
      - "too many requests"
    exit_codes:
      crash: [1, 137]

  codex:
    binary: codex
    invoke: "codex exec"
    flags:
      output_format: "--json"
      auto_approve: "--full-auto"
      working_dir: "-C"
      add_dir: "--add-dir"
    quota_patterns:
      - "rate limit"
      - "429"
    exit_codes:
      crash: [1, 137]

  gemini:
    binary: gemini
    invoke: "gemini -p"
    flags:
      output_format: "-o json"
      auto_approve: "-y"
      resume: "--resume"
      add_dir: "--include-directories"
    quota_patterns:
      - "RESOURCE_EXHAUSTED"
      - "429"
    exit_codes:
      crash: [1]

  copilot:
    binary: copilot
    invoke: "copilot -p"
    flags:
      output_format: "--output-format json"
      auto_approve: "--yolo"
      autopilot: "--autopilot --no-ask-user"
      max_turns: "--max-autopilot-continues"
      resume: "--resume="
      add_dir: "--add-dir"
    quota_patterns:
      - "rate limit"
      - "429"
    exit_codes:
      crash: [1, 137]

# Model catalog — ONE place to update when new models release
models:
  claude:
    frontier: claude-opus-4-6
    standard: claude-sonnet-4-6
    fast: claude-haiku-4-5
  codex:
    frontier: o3-pro
    standard: o3
    fast: gpt-4.1-mini
  gemini:
    frontier: gemini-2.5-pro
    standard: gemini-2.5-flash
    fast: gemini-2.5-flash-lite
  copilot:
    frontier: claude-opus-4-6
    standard: claude-sonnet-4-6
    fast: gpt-4.1

# Tier preferences — just provider order, resolved via catalog
tiers:
  frontier:
    preference: [claude, codex, gemini, copilot]
  standard:
    preference: [claude, codex, gemini, copilot]
  fast:
    preference: [codex, claude, gemini, copilot]

# Backoff configuration
backoff:
  initial_ms: 60000
  multiplier: 5
  max_ms: 3600000
  reset_after_hours: 24
  auto_recover: true
  auto_recover_interval_ms: 300000
```

### `afk init` Auto-Detection

```bash
afk init
# Detecting available agent CLIs...
# ✓ claude — /usr/local/bin/claude (v1.2.3, logged in)
# ✓ codex — /usr/local/bin/codex (v0.9.1, authenticated)
# ✗ gemini — not found in PATH
#
# Tier resolution:
#   frontier: claude/claude-opus-4 (fallback: codex/o3-pro)
#   standard: claude/claude-sonnet-4 (fallback: codex/o3)
#   fast:     codex/gpt-4.1-mini (fallback: claude/claude-haiku-4)
```

### Repo-Level Overrides

Same keys, deepMerge resolution. Override only what you need:

```yaml
# <repo>/afk/config.yaml — repo-level override
models:
  claude:
    frontier: claude-sonnet-4          # This repo doesn't need Opus

tiers:
  fast:
    preference: [claude, codex]        # This repo doesn't use gemini
```

### Model Resolution

```typescript
function resolveModel(step: StepConfig, providerStatus: ProviderStatus): ResolvedModel {
  if (step.model) {
    const [providerName, modelName] = step.model.split('/');
    return { provider: providerName, binary: provider.binary, model: modelName, flags: provider.flags };
  }

  const tierConfig = config.tiers[step.tier];
  for (const providerName of tierConfig.preference) {
    const provider = config.providers[providerName];
    if (!provider.available) continue;
    if (providerStatus[providerName].status === 'rate_limited') continue;
    const model = config.models[providerName][step.tier];
    return { provider: providerName, binary: provider.binary, model, flags: provider.flags };
  }
  throw new Error(`No available provider for tier: ${step.tier}`);
}
```

### Consensus Slot Filling

Consensus slot filling uses the same `resolveModel` infrastructure but fills N slots instead of one:

```typescript
function fillConsensusSlots(count: number, tier: ModelTier, providerStatus: ProviderStatus): ResolvedModel[] {
  const slots: ResolvedModel[] = [];
  const used = new Set<string>();

  // Fill with preferred providers first (one slot per unique provider)
  for (const providerName of config.consensus.preferred_providers) {
    if (slots.length >= count) break;
    if (used.has(providerName)) continue;
    const provider = config.providers[providerName];
    if (!provider.available || providerStatus[providerName].status === 'rate_limited') continue;
    slots.push({ provider: providerName, model: config.models[providerName][tier] });
    used.add(providerName);
  }

  // Fill remaining slots with fallback providers
  for (const providerName of config.consensus.fallback_providers) {
    if (slots.length >= count) break;
    if (used.has(providerName)) continue;
    const provider = config.providers[providerName];
    if (!provider.available || providerStatus[providerName].status === 'rate_limited') continue;
    slots.push({ provider: providerName, model: config.models[providerName][tier] });
    used.add(providerName);
  }

  // If still short, allow duplicate providers at lower tiers
  if (slots.length < count) {
    // Fill remaining with best available at standard or fast tier
  }

  return slots;
}
```

### Provider Status Tracking & Auto-Recovery

Provider status is maintained at `~/.afk/provider-status.json`. When AFK falls back from primary to fallback, it starts a recovery probe timer. Every 5 minutes, it probes the primary. When the probe succeeds, the supervisor switches back. This prevents the "stuck on fallback forever" bug.

---

## 16. Communication Layer

### Architecture

AFK's communication is a pluggable interface with three input sources and one output channel:

**Inputs** (things that can affect the session):
1. **Filesystem** — inbox directory watching, heartbeat files (existing)
2. **Linear** — ticket polling and status sync (existing)
3. **Telegram** — command-based input from your phone (new)

**Output** (notifications):
1. **Telegram** — session events, status responses, alerts, gate approvals (new)
2. **Filesystem** — reports, logs (existing)

### Telegram Command Interface

Not a natural language chat. A defined command set:

| Command | Action |
|---------|--------|
| `/status` | Current session state, per-project summary |
| `/plan` | Current plan status with task completion |
| `/pause [project]` | Pause a track or all projects |
| `/resume [project]` | Resume |
| `/task "description"` | Add task to queue |
| `/handoff` (+ file attachment) | Drop PRD for decomposition + execution |
| `/context` (+ file attachment) | Drop file into inbox |
| `/logs [project]` | Last 10 entries from track's log |
| `/graph` | Text summary of decision tree |
| `/abort [project]` | Kill a track |
| `/mode full\|supervised\|assisted` | Switch autonomy mode |
| `/approve [project]` | Approve current gate |
| `/deny [project] reason` | Deny with feedback |
| `/help` | List available commands |

Outbound notifications (configurable):
- Session started / completed
- Project completed a task (with commit hash)
- Project hit quota (with estimated wait time)
- Project failed after max restarts
- Items moved to "Needs Input" (action required from you)
- Re-plan triggered (with summary of what changed)
- Exploration mode entered
- Human gate reached (with approval command)

### Implementation

Phase 1: Use `grammy` (Telegram bot framework for TS/Bun) with long-polling. No server, no webhooks, no public endpoint. The supervisor runs a polling loop alongside its heartbeat monitoring loop. Scoped to one chat ID (yours) — all other messages are ignored.

### Security

- Bot token stored in `~/.afk/secrets/telegram.json`, never in the repo, never in `afk/`
- Only messages from your configured chat ID are processed
- Commands can only affect `afk/` through the same CLI functions — no direct file manipulation
- No message content is sent to agents — Telegram is a control plane for the supervisor, not an input channel for the LLM

---

## 17. Memory Architecture — 5-Layer Structured Memory

### The 5 Layers

```
~/.afk/                                    # Global memory (cross-repo)
├── memory/
│   ├── global-learnings.md                # Cross-repo patterns (<100 lines)
│   ├── model-behavior.md                  # Per-provider observations (<50 lines)
│   ├── failure-gates.md                   # "Never do X" rules from past failures
│   └── provider-stats.jsonl               # Duration, reliability per provider

<repo>/afk/                                # Per-repo memory (local only)
├── MEMORY.md                              # Project memory (<150 lines)
├── active-context.md                      # Current focus (<50 lines)
├── repo-map.json                          # Tree-sitter structural index
└── decision-index.jsonl                   # Past decisions, searchable
```

### Layer 1: Always-Loaded Context (~1.5K tokens)

Injected into every step. Small enough to never compete with task context.

**`afk/MEMORY.md`** (<150 lines): Architecture decisions, code conventions, known gotchas, integration patterns, test conventions. The agent reads but never writes — the supervisor manages updates through the session-end ritual.

**`afk/active-context.md`** (<50 lines): What's in flight, recent pivots, temporary notes. Updated by the supervisor between sessions.

### Layer 2: Structural Code Index (~1K tokens)

**`afk/repo-map.json`** — Generated at session start via tree-sitter. Parses the codebase, uses PageRank to identify important symbols, compressed to ~1K tokens. Gives broad codebase awareness without loading files. Regenerated at session start and after each COMMIT step.

### Layer 3: Failure Gates (~200 tokens)

**`~/.afk/memory/failure-gates.md`** — Rules learned from actual mistakes:

```markdown
# Failure Gates

1. [2026-03-10] NEVER use `fs.writeFileSync` in async handlers — caused race condition
2. [2026-03-12] ALWAYS check for null from `db.findUnique()` — agent skipped this twice
3. [2026-03-14] When Drizzle migration fails, DO NOT retry same migration — drop and recreate
4. [2026-03-15] Standard tier consistently fails IMPLEMENT for cross-module refactors — auto-upgrade to frontier
```

Maximum 20 gates. Triggered gates promote to top. Gates untriggered for 90 days are pruning candidates. Some gates inject into the supervisor's tier selection logic, not the agent's prompt.

### Layer 4: Decision Index (On-Demand Retrieval)

**`afk/decision-index.jsonl`** — Accumulated from all past sessions. NOT always-loaded. Searched on-demand during ANALYZE: "Check decision index for past decisions about [current task tags]." Also searched by the planner and re-planner.

### Layer 5: Session-End Learning Ritual

After every session review, the supervisor runs a distillation step:

```typescript
async function extractLearnings(session: Session): Promise<void> {
  const decisions = await readAllDecisions(session);
  const reviews = await readAllReviews(session);
  const replans = session.plan?.replan_history ?? [];

  const learnings = await llmCall({
    tier: 'fast',
    prompt: `Extract from this session:
      1. Durable facts about this codebase
      2. Decisions that led to pivots
      3. Recurring review findings
      4. New failure gates
      5. Re-plan patterns (what assumptions broke and why)
      Output as structured JSON.`,
    context: { decisions, reviews, replans }
  });

  await mergeIntoMemory('afk/MEMORY.md', learnings.facts);
  await appendToDecisionIndex('afk/decision-index.jsonl', learnings.decisions);
  await updateFailureGates('~/.afk/memory/failure-gates.md', learnings.gates);
  await updateProviderBehavior('~/.afk/memory/model-behavior.md', session.providerStats);

  await pruneMemory('afk/MEMORY.md', { maxLines: 150, strategy: 'importance' });
}
```

### Git-Backing

Memory files live in the local `afk/` directory. While the directory itself is gitignored, memory and decision-index files can optionally be committed to the repo if you want them to travel with it.

---

## 18. Unified Security Policy — AWS-Style Deny-Wins

### Philosophy: Default-Deny, Deny-Always-Wins

Every operation is blocked unless explicitly permitted. Policies use the same schema everywhere. A policy is a list of statements. Each statement has an effect (`deny` or `allow`), a scope, and an ID.

### Policy Layers

```
~/.afk/config.yaml          → global policy
<repo>/afk/policy.yaml       → repo policy
afk/config.yaml              → session policy
workflow.steps.<step>.policy  → step policy
```

### Evaluation Rules

```
1. Collect ALL statements from ALL layers into one flat list
2. Find statements matching the requested action
3. No match → implicit deny (default-deny)
4. ANY matching deny → deny (deny always wins, regardless of layer)
5. At least one allow + no deny → allow
```

A narrower layer cannot override a broader layer's deny. But any layer can deny what another layer allows.

### The Universal Policy Schema

```yaml
policy:
  statements:
    - sid: "human-readable-id"
      effect: deny | allow
      commands: ["glob patterns"]
      paths: ["glob patterns"]
      network:
        domains: ["glob patterns"]
      filesystem: read | write | execute
```

### Global Policy (`~/.afk/config.yaml`)

```yaml
policy:
  statements:
    - sid: "block-dangerous-commands"
      effect: deny
      commands:
        - "rm -rf *"
        - "sudo *"
        - "npm publish"
        - "git push *"
        - "git remote *"
        - "docker *"
        - "kubectl *"
        - "ssh *"
        - "scp *"
        - "curl * | sh"
        - "wget * | bash"

    - sid: "block-sensitive-paths"
      effect: deny
      paths:
        - "~/*"
        - "/etc/*"
        - "/usr/*"
        - ".env*"
        - "*.pem"
        - "*.key"

    - sid: "block-network-default"
      effect: deny
      network:
        domains: ["*"]

    - sid: "allow-documentation-fetch"
      effect: allow
      network:
        domains:
          - "developer.mozilla.org"
          - "docs.github.com"
          - "nodejs.org"
          - "typescriptlang.org"

    - sid: "allow-llm-providers"
      effect: allow
      network:
        domains:
          - "api.anthropic.com"
          - "api.openai.com"
          - "generativelanguage.googleapis.com"

    - sid: "allow-safe-commands"
      effect: allow
      commands:
        - "cat"
        - "ls"
        - "grep"
        - "find"
        - "diff"
        - "git add"
        - "git commit"
        - "git diff"
        - "git log"
        - "git status"

    - sid: "allow-build-test"
      effect: allow
      commands:
        - "npm test"
        - "npm run lint"
        - "npm run typecheck"
        - "npm run build"
        - "bun test"
        - "bun run *"

    - sid: "allow-source-paths"
      effect: allow
      paths:
        - "./src/**"
        - "./tests/**"
        - "./docs/**"
        - "./afk/projects/**"
        - "./package.json"
        - "./tsconfig.json"
```

### Policy Evaluator

```typescript
function evaluate(
  action: SecurityAction,
  layers: PolicyLayer[]
): 'allow' | 'deny' {
  const allStatements = layers.flatMap(l => l.policy?.statements ?? []);
  const matches = allStatements.filter(s => matchesAction(s, action));

  if (matches.length === 0) return 'deny';
  if (matches.some(s => s.effect === 'deny')) return 'deny';
  return 'allow';
}
```

### Audit Trail

Every shell command the agent executes is logged to `each project's `audit.jsonl``. The morning report includes an audit summary: total commands run, any blocked attempts.

---

## 19. Unified Config Layering (Non-Security)

The unified schema principle extends beyond security. Anywhere AFK has layered config, the keys are identical across scopes. For non-security settings, **narrowest scope wins**:

```
~/.afk/config.yaml           # Global defaults
<repo>/afk/config.yaml        # Repo overrides
```

Resolution:

```typescript
function resolveConfig(...layers: Partial<Config>[]): Config {
  return deepMerge(...layers);
}
```

Security is the exception: it uses deny-wins, not narrowest-wins. Everything else follows standard override semantics.

---

## 20. Repair & Recovery

### `afk doctor`

Scans the `afk/` directory structure, validates all files against Zod schemas (including workflow definitions and plan files), reports what's broken, and offers to fix or reset:

```bash
afk doctor
# AFK Doctor — scanning afk/
# ✓ config.yaml — valid
# ✓ workflows/default.yaml — valid
# ✓ plans/auth-system-plan.yaml — valid (v2, 5 tasks)
# ✗ projects/auth-system/heartbeat.json — invalid: missing "agent" field
#   → fix: add default "agent": "claude" field
# ✗ projects/payment-api/decisions.jsonl — line 14 invalid JSON
#   → fix: quarantine line 14 to decisions.jsonl.quarantine
# ✓ tasks.md — valid
# ✓ context/ — all files present
# ✓ MEMORY.md — present (142 lines, within 150-line limit)
# ✓ policy.yaml — valid
#
# 2 issues found. Run `afk doctor --fix` to auto-repair.
```

### Graceful Degradation

- **Corrupted heartbeat.json**: Supervisor recreates from last known state (in-memory project state). Logs the corruption.
- **Malformed tasks.md**: Parse what's valid, quarantine malformed lines to `tasks.md.quarantine`, log the issue. Session continues with the parseable tasks.
- **Missing project directory files**: Recreate empty files with default content. The agent can function with missing progress.md or log.md — it just starts fresh for those files.
- **Corrupted decisions.jsonl**: Read valid lines, skip invalid ones, log the skipped line numbers. The decision graph shows a gap, not an error.
- **Missing `afk/context/` files**: Abort session start with a clear error. Context files are required.
- **Missing MEMORY.md or active-context.md**: Create empty files. Memory injection proceeds with empty content.
- **Invalid workflow YAML**: Abort session start with a clear error pointing to the invalid workflow. Fall back to default workflow if available.
- **Corrupted plan YAML**: Log the corruption. If mid-session, continue with last known good plan version from replan_history.

### Reset Commands

```bash
afk reset --keep-context    # Wipe projects/, graph/, archive/ but keep config, context/, specs/, memory, workflows/
afk reset --full            # Wipe entire afk/ and re-scaffold from templates
afk reset --project auth-system   # Reset only one project (keep others)
```

### File Locking

All writes to shared files use atomic write-then-rename via `Bun.write()` to a temp file, then `fs.renameSync()` to the target. This prevents partial writes from corrupting files when the supervisor and agents write concurrently.

Schema versioning: all file formats include a `version` field. Future schema changes can be migrated by `afk doctor` detecting an old version and upgrading it.

---

## 21. Agent Loop Hardening — Known Failure Modes

These are the critical failure modes to design against. For each: what goes wrong, how the system prevents it, and what catches it.

### Failure: Context window exhaustion mid-task

**What happens**: Agent loses context of what it was doing halfway through implementation.
**Prevention**: Step-specific prompts keep context small. Each step starts fresh. Pre-step context budget estimation catches oversized inputs. Mid-step monitoring triggers checkpoints at 80% capacity.
**Detection**: `step_complete.json` must contain a meaningful summary. Empty or garbled → retry with reduced context.

### Failure: Agent ignores review feedback

**What happens**: Agent receives "needs-changes" verdict, loops back to IMPLEMENT, produces the same code.
**Prevention**: Supervisor compares the diff before and after a review-fix cycle. Identical diff (Levenshtein < 5%) → stuck → try different provider or needs-input.
**Detection**: Diff comparison between review rounds.

### Failure: Agent claims it ran tests but didn't

**What happens**: Agent writes "all tests pass" but never actually executed `npm test`.
**Prevention**: The VALIDATE step is run by the supervisor, not the agent. The agent cannot fake this.
**Detection**: Audit log shows whether `npm test` was actually executed and exit code.

### Failure: Agent modifies files outside task scope

**What happens**: Agent "helpfully" refactors unrelated code while implementing a feature.
**Prevention**: Step-level policy can restrict write access. REVIEW's Architect persona checks scope compliance. Supervisor computes file-path diff against spec.
**Detection**: Morning report includes per-task file change summary.

### Failure: Infinite retry loop on flaky tests

**What happens**: A test passes sometimes and fails others. Agent keeps re-running.
**Prevention**: Error classifier distinguishes semantic from deterministic errors. LoopDetector catches identical failing calls. Max retry count per validation step (default: 3).
**Detection**: Audit log shows repeated identical test commands.

### Failure: Plan assumptions are wrong

**What happens**: The original PRD decomposition made incorrect assumptions about existing code structure or API availability.
**Prevention**: This is exactly what automatic re-planning handles. Agent signals plan invalidation with concrete evidence. Re-planner produces updated plan with new understanding. Guardrails prevent infinite re-planning (max 3 per session).
**Detection**: `plan_invalidation` decisions in the decision log. Re-plan events in the timeline.

### Failure: Re-planning loop

**What happens**: Every re-plan produces another plan that fails, creating a re-planning loop.
**Prevention**: Maximum re-plans per session (default: 3). After the cap, the session pauses and escalates to human review with full context.
**Detection**: `replan` decision count in the session.

### Failure: Dependency deadlock

**What happens**: Task A depends on task B which depends on task A — a circular dependency.
**Prevention**: Plans must be DAGs (directed acyclic graphs). The planner and re-planner validate no cycles exist. The supervisor rejects plans with circular dependencies.
**Detection**: Cycle detection during plan validation.

---

## 22. CLI Command Reference

### Core Commands

```bash
afk new <name> [--from <file>] [--template <t>] [--start]  # Create new project
afk init                                                     # Scaffold afk/ in existing repo
afk handoff <file> [--plan-only] [--workflow <w>] [--dry-run] # Drop PRD for decomposition + execution
afk start                                       # Start session
afk pause [--project <n> | --all]                             # Pause project(s)
afk resume [--project <n> | --all]                            # Resume project(s)
afk status                                                   # Live dashboard
afk plan                                                     # Show current plan status
afk report                                                   # Morning summary
afk graph                                                    # Print decision tree

# Task management
afk add-task "description" [--spec ./spec.md] [--workflow bugfix]
afk add-context ./research.md

# Review actions
afk adopt --project auth-system                               # Merge entire project branch
afk adopt --project auth-system --tasks task1,task2           # Cherry-pick specific commits
afk drop --project payment-api                                # Discard project branch
# Human gates
afk approve <token> [--skip]
afk deny <token> --reason "rework X"
afk mode supervised [--project <name>]

# Maintenance
afk reset [--keep-context | --full | --project auth-system]
afk archive
afk doctor [--fix]
afk audit [--fix]
```

### `afk handoff` — The Primary Command

```bash
afk handoff ./prd.md                   # Decompose PRD → plan → execute
afk handoff ./prd.md --plan-only       # Just produce the plan, don't execute
afk handoff ./prd.md --workflow bugfix  # Use a specific workflow for all tasks
afk handoff ./prd.md --dry-run         # Show what would be created without doing it
```

### `afk new` — Project Creation

```bash
afk new my-prototype                        # Create bare project
afk new my-prototype --from research.md     # Create from research output
afk new my-api --template express-ts        # Use a project template
afk new my-app --from prd.md --start        # Create, plan, and start immediately
```

---

## 23. Key Design Decisions

### Why Bun over Node?
Startup time. The CLI runs `afk status` dozens of times a day. Bun cold-starts in ~20ms vs Node's ~100ms. Also: native file watching, built-in test runner, single-binary compilation.

### Why files for the agent protocol AND SQLite for operational state?
Two audiences, two storage layers. The **agent protocol** uses files (markdown, JSON, YAML) because agents read and write markdown natively, you can `cat` any state file to debug, `git diff` shows what changed, memory travels with the repo, and archive = move a directory. The **supervisor's operational state** — session tracking, event streams, message history, token accounting, consensus results — uses SQLite (via Bun's native `Database`) because this data benefits from indexed queries, foreign keys, WAL-mode concurrent access, and structured aggregation. The boundary is clean: files are what agents see; SQLite is what the supervisor queries internally.

### Why heartbeat files over process monitoring?
A process can be alive but stuck. Heartbeat files prove the agent is making *progress*, not just running.

### Why worktrees over branches with checkout?
Worktrees are parallel — project-1 and project-2 can both run `npm test` simultaneously. Branch checkout is serial.

### Why Project as the top-level entity?
A Project maps 1:1 to a worktree, a branch, and a deliverable. When you hand off three PRDs to the same repo, you want three isolated branches, each independently mergeable. The old "track" concept (parallel agents competing on the same task) is replaced by projects working on different tasks in parallel. The hierarchy is clean: Session → Project → Task → Step. SQLite tracks the relational mappings (project→worktree→branch, project→plan→tasks).

### Why deterministic orchestration over prompt-driven loops?
Every flow control decision delegated to the LLM is a failure mode. The supervisor owns the state machine. The agent handles creative work within steps. This is the single most important architectural decision in AFK.

### Why workflow definitions over hardcoded steps?
Different task types need different workflows. A bug fix doesn't need a test plan step. A research spike doesn't need implementation. Custom workflows let you match the process to the work.

### Why consensus for planning only, not implementation?
Multiple perspectives improve *understanding of the problem* — different models catch different edge cases, notice different architectural concerns. But once you have a good plan, one capable model writing the code is sufficient. Consensus on implementation would mean merging code from N agents — complexity without proportional value.

### Why slot-based consensus over fixed provider lists?
Providers hit quota unpredictably. Slots mean "give me N perspectives" — the supervisor fills those slots with whatever's available, substituting fallback providers transparently. Quality degrades gracefully rather than failing entirely.

### Why automatic re-planning instead of manual?
The whole point of AFK is overnight autonomy. If the plan breaks at 3am, you don't want to wake up to a stuck system — you want it to have adapted and continued. Re-planning with evidence (not speculation) is what makes AFK genuinely autonomous rather than just a task runner.

### Why revert-and-rebuild over fix-on-top?
When the plan's assumptions are wrong, every commit built on those assumptions is tainted. Applying fixes on top of a wrong foundation creates compounding errors — each fix inherits the bad assumptions and introduces more. `git revert` to a known-good state + rebuild from scratch with correct understanding is always cleaner. The re-planner explicitly reasons about which commits are tainted vs valid, and the supervisor handles the revert mechanically.

### Why explicit dependency waiting over implicit coordination?
Simple, debuggable, correct. A task blocks on its dependency's commit with a clear `waiting_on` reference. No polling, no race conditions, no hidden state.

### Why standalone workflow definitions over inheritance?
Inheritance creates hidden coupling — changing the parent workflow silently affects all children. Standalone definitions are explicit and debuggable. The flow builder can use existing workflows as starting points (copy + modify), giving convenience without coupling.

### Why neutral tiers instead of direct model names?
A model catalog maps `frontier`, `standard`, `fast` to concrete models per provider. When a new model releases, you update one line in the catalog.

### Why AWS-style policy over flat allowlists?
Same schema everywhere. Deny always wins. Defense-in-depth. The evaluator is trivial (15 lines of code) but the security surface is comprehensive.

### Why 5-layer memory instead of one big file?
Different memory has different lifetimes and injection patterns. Always-loaded context is cheap enough for every step. Failure gates modify supervisor behavior, not just prompts. The decision index grows unboundedly but is searched on-demand.

### Why a planner over simple PARSE decomposition?
A PRD is a complex document with implicit dependencies. Flat task lists lose ordering information. A task graph with dependency edges enables parallel execution of independent tasks while respecting ordering constraints.
