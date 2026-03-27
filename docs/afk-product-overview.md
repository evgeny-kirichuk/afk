# AFK — Product Overview

## What is AFK?

AFK is a **workflow orchestrator for autonomous coding agents** designed to run overnight while you're away. Drop a PRD or feature spec, and AFK decomposes it into a dependency-ordered plan, generates implementation specs, and executes them using configurable deterministic workflows. It's built for macOS as both a CLI and desktop app, targeting developers who want their codebase to evolve while they sleep.

## Core Mental Model

### The Handoff Interaction

The primary workflow is the **handoff**: you provide a document (PRD, research output, task description), and AFK:
1. Breaks it down into an executable plan with dependency ordering
2. Generates detailed specs for each task
3. Implements them using autonomous agents
4. Delivers clean, mergeable git branches

### Entity Hierarchy

```
Session (one execution of `afk start`)
  └── Project (isolated unit of work)
      ├── Project "auth-system"  → git worktree → branch afk/auth-system
      ├── Project "payment-api"  → git worktree → branch afk/payment-api
      └── Project "dashboard"    → git worktree → branch afk/dashboard
```

**Projects** are the unit of isolation and delivery. Each gets:
- Its own git worktree (parallel execution)
- Its own branch (independent mergeability)
- Its own dependency-ordered task queue (sequential execution within project)
- Its own plan (what gets built and why)

Multiple projects run in parallel on the same repo without interference. Each produces a single branch you can merge, cherry-pick from, or discard entirely.

## Key Capabilities

### 1. Workflow Builder

Every execution follows a named **workflow** — a typed sequence of steps with transitions, conditions, and execution modes. The `default` workflow covers planning → spec generation → implementation → review → commit. Custom workflows adapt the process to the work type:

- **Bugfix workflow**: No test plan step, fast iteration
- **Research workflow**: No implementation, just exploration and documentation
- **Custom workflows**: Define your own step sequences for domain-specific needs

Workflows are YAML definitions that configure:
- Step sequences and transitions
- Which steps run in consensus mode (multiple agents analyze independently, synthesis agent merges findings)
- Which steps trigger human gates (approval required before proceeding)
- Error handling and retry policies per step

### 2. Consensus Mode

When multiple perspectives improve outcomes, AFK runs steps in **consensus mode**:
- Multiple models analyze the problem independently
- A synthesis agent merges their findings into a unified output
- Used for planning and analysis, not implementation

**Philosophy**: Consensus for understanding the problem, single capable agent for execution. Multiple perspectives catch different edge cases during planning. Once you have a good plan, one model writing the code is sufficient.

### 3. Adaptive Re-Planning

When mid-execution evidence proves the plan is wrong, AFK **automatically re-plans** with accumulated context. Crucially, the re-planner can instruct the supervisor to **revert** the last N commits or tasks — resetting the project to a known-good state before continuing.

**Why revert-and-rebuild?** Fixes built on top of wrong assumptions create compounding errors. Resetting to known-good state + rebuilding with correct understanding is cleaner than inheritance of bad decisions.

### 4. Variable Autonomy Modes

Three runtime modes control human-in-the-loop gates:

- **Full autonomy**: Run overnight unattended. No human gates.
- **Supervised**: Pause at key decision points for review/approval.
- **Assisted**: Human approves every major step. For new or sensitive repos.

Switch modes mid-session on a per-project basis. Resume tokens let you pick up exactly where you paused.

### 5. Project Creation (`afk new`)

AFK isn't just for existing repos — it can create new projects from scratch:

```bash
afk new my-prototype                        # Create bare project
afk new my-prototype --from research.md     # Create from research output
afk new my-api --template express-ts        # Use a project template
afk new my-app --from prd.md --start        # Create, plan, and start immediately
```

### 6. Exploration Mode

When the task queue empties, agents can switch from "implement specs" to "explore codebase":
- Find bugs and security issues
- Suggest architectural improvements
- Write improvement proposals
- Document undocumented systems

Exploratory outputs are clearly tagged and never auto-merged — they're proposals for human review.

### 7. Heartbeat Supervision

Agents write heartbeat files proving they're making progress. The supervisor watches. Stale heartbeat = dead/stuck agent = automatic restart from last checkpoint. A running process isn't useful if it's stuck — heartbeats prove *progress*.

### 8. Atomic Commits

Each completed task = one squashable commit. Review the project branch, cherry-pick the commits you want, drop the rest. Commits are the atomic unit of review and adoption.

## How You Interact with AFK

### Primary Commands

```bash
# Drop a PRD for decomposition and execution
afk handoff ./prd.md
afk handoff ./prd.md --plan-only        # Just produce the plan
afk handoff ./prd.md --workflow bugfix  # Use specific workflow

# Create new projects
afk new my-app --from prd.md --start

# Session control
afk start                               # Start the session
afk pause --project auth-system         # Pause specific project
afk resume --all                        # Resume all projects
afk status                              # Live dashboard

# Review and adoption
afk adopt --project auth-system                      # Merge entire project branch
afk adopt --project auth-system --tasks task1,task2  # Cherry-pick specific commits
afk drop --project payment-api                       # Discard project branch

# Human gates (supervised mode)
afk approve <token>                     # Approve and continue
afk deny <token> --reason "rework X"   # Send back for rework
```

### The Desktop App

A macOS app (via Tauri) provides:
- Live dashboard showing all projects and their progress
- Real-time task status and agent activity
- Review interface for approvals/denials
- Project branch visualization
- Session reports and summaries

Both CLI and app read the same state files — use whichever fits your workflow.

## Architecture Principles

### Deterministic Orchestration, Creative Execution

The supervisor controls the loop deterministically in code:
- Step transitions
- Review counting
- Phase changes
- Re-planning triggers
- Error handling

The agent handles creative work within each step. **Orchestration is never delegated to the LLM via markdown instructions.** Every flow control decision delegated to the model is a failure mode.

### File-First + SQLite Hybrid

Two audiences, two storage layers:

**Files** (agent protocol):
- Agents read and write markdown/JSON/YAML natively
- You can `cat` any state file to debug
- `git diff` shows what changed
- Archive = move a directory

**SQLite** (supervisor's operational state):
- Session tracking, event streams, message history
- Token accounting, consensus results
- Project → task → worktree relationships
- Structured queries and aggregation

The boundary is clean: files are what agents see; SQLite is what the supervisor queries internally.

### Provider-Neutral CLI Routing

AFK spawns local CLI binaries (`claude`, `codex`, `gemini`, `copilot`) — it doesn't call provider APIs directly. A model catalog maps neutral tiers to concrete models:

- **frontier** → highest capability (reasoning, complex tasks)
- **standard** → balanced cost/performance
- **fast** → quick iteration, simple tasks

When a provider hits quota or fails, the system fails over automatically to another provider. The file protocol doesn't care which CLI produced the commit.

### Security by Default-Deny

Agents operate under AWS-style unified security policy:
- Deny always wins
- Policies stack across four layers: global → repo → session → step
- Same schema everywhere
- Agents can only access what is explicitly allowed

Policy statements define allowed/denied resources, actions, and conditions. Defense-in-depth without complexity.

### Memory System (5 Layers)

Different memory types serve different purposes:

1. **Always-loaded context**: `MEMORY.md`, `active-context.md`, `ROUTER.md` — injected into every agent prompt
2. **Tree-sitter repo map**: Structural code index, searchable on-demand
3. **Failure gates**: Past errors that modify supervisor behavior (e.g., "never trust test X")
4. **Decision index**: Searchable log of all decisions (`decisions.jsonl`)
5. **Session-end learning**: Post-session synthesis of patterns and lessons

Layers 1-3 are sufficient initially. Layers 4-5 have steep value curves and can be deferred.

## Installation and Setup

### Global Tool, Per-Repo Sessions

- **Global installation**: `~/.afk/` for config, memory, secrets, provider status
- **Per-repo sessions**: `afk/` directory in each repo (gitignored)
- **Project creation**: `afk new` creates standalone projects outside existing repos

### Quick Start

```bash
# Install globally
npm install -g @evgeny/afk

# Initialize in existing repo
cd my-project
afk init

# Or create new project
afk new my-app --from prd.md

# Drop a PRD and let it run
afk handoff ./feature-prd.md
afk start
```

The entire `afk/` directory is gitignored — it's ephemeral session state, not project source code. AFK's deliverables are the code changes and commits in each project's branch.

## Design Philosophy

### What Makes AFK Different

**Overnight autonomy**: Most "autonomous" systems are actually supervised task runners. AFK is designed to run 8 hours unattended. When it encounters a broken plan at 3am, it re-plans with evidence and continues — you don't wake up to a stuck system.

**Project isolation**: Multiple PRDs targeting the same repo each get isolated worktrees and branches. No interference, independently mergeable deliverables.

**Workflow-first**: The orchestration logic lives in declarative YAML workflows, not scattered through prompts and code. Custom workflows are first-class citizens.

**Consensus where it matters**: Multiple perspectives for understanding problems (planning, analysis). Single capable agent for execution. Complexity with purpose.

**Revert-capable re-planning**: When assumptions are wrong, AFK can back out bad commits before rebuilding. Fixes on top of wrong foundations create compounding errors.

**File-based protocol**: Human-readable state files. Debuggable with `cat` and `grep`. The Unix way.

### What AFK Doesn't Do

- **Not a code editor**: Doesn't integrate with VSCode or Cursor. Operates at the repository/branch level.
- **Not real-time**: Designed for batch overnight execution, not instant iteration.
- **Not a chat interface**: Non-conversational. You hand off documents, it delivers branches.
- **Not provider-agnostic in execution**: Uses local CLI binaries for specific providers, not generic API wrappers.

## Deferred Until Core Loop Proven

These features are architecturally sound but deferred until the core workflow is battle-tested:

- **Tree-sitter repo map**: Needs a spike to validate information density value
- **Assisted autonomy mode**: Full autonomy is the core use case; assisted risks overbuilding for MVP
- **Memory layers 4-5**: Steep value curve; layers 1-3 sufficient initially
- **Multi-provider CLI routing**: Treat as Claude-only until real CLI behavior is tested

## Status

**Current state**: Two synchronized foundational documents (architecture recommendations, framework spec) are conceptually ready for implementation planning.

**Pre-coding decisions flagged as unresolved**:
1. Step contract / file protocol overlap (source-of-truth ambiguity between `decisions.jsonl` and `step_complete.json`)
2. Loop explosion risk (combined review/validate/retry could produce ~15 LLM invocations per task without caps; needs iteration limit design)

**Next milestone**: Implementation of core deterministic workflow engine and file-based protocol.
