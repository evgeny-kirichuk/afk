# Harness Taxonomy
## A universal framework for assessing any coding agent harness

Each module contains numbered concepts. Each concept has labeled options (A/B/C…).
Use the option letters in the tool matrix to describe any harness precisely.

---

## Archetype (assess this first)

**H.1 — Harness type**
- (A) **API harness** — talks directly to raw model APIs. Owns the agent loop entirely.
- (B) **Meta-harness** — spawns first-party CLI tools. Delegates the agent loop to sub-harnesses.
- (C) **Hybrid** — has both an internal agent loop and a CLI-spawn mode; switches by config.
- (D) **MCP plugin** — runs inside another agent's context as an MCP server. No direct model access.
- (E) **IDE extension** — embedded inside an editor, inherits editor's process model and auth.
- (F) **Platform** — multi-layer system combining several archetypes under one product.
- (G) **Coordination backbone** — task/state management layer designed as substrate for orchestrators. No model access, no agent loop.

> All modules below apply to all archetypes. Concepts marked *[meta only]* are N/A for pure API harnesses.

---

## M0 — Model Interface
*How the harness reaches the model or sub-harness.*

**M0.1 — Transport**
- (A) HTTP/REST with API key → vendor endpoint
- (B) Vendor SDK wrapper (abstracts HTTP)
- (C) PTY spawn — forkpty(), process believes it has a real terminal
- (D) Pipe spawn — anonymous stdin/stdout pipes, no TTY
- (E) tmux session — process runs in named tmux window, communicated via send-keys / capture-pane
- (F) Unix socket / IPC — structured protocol over local socket
- (G) MCP server — JSON-RPC protocol, loaded inside another agent's context
- (H) WebSocket — persistent bidirectional connection to model endpoint
- (I) gRPC — protobuf-based RPC to model or orchestration service
- (J) ACP (Agent Client Protocol) — JSON-RPC 2.0 over stdio, standardized editor↔agent protocol (Zed, JetBrains, Goose, Gemini CLI)

**M0.2 — Auth model**
- (A) API key per vendor — stored in env var or config file
- (B) Subscription OAuth — user's Claude.ai / OpenAI login, stored in CLI credential store
- (C) Credential inheritance — meta-harness spawns CLI which finds its own stored credentials
- (D) Per-user pass-through — each end user brings their own credentials
- (E) Shared operator key — one API key serves all users of the tool

**M0.3 — Provider scope**
- (A) Single vendor, hardcoded
- (B) Single vendor, configurable model
- (C) Multi-vendor, homogeneous (same interface for all)
- (D) Multi-vendor, heterogeneous (different CLI binary per vendor)

**M0.4 — Model selection**
- (A) None — hardcoded model string
- (B) Named model in config
- (C) Capability tiers — frontier / standard / fast resolved at runtime
- (D) External model registry or catalog

**M0.5 — Streaming**
- (A) SSE / chunked HTTP (API harness)
- (B) Raw stdout, line-buffered
- (C) NDJSON structured event stream
- (D) PTY raw byte stream with ANSI escape codes
- (E) tmux capture-pane (polled snapshot, not streaming)

**M0.6 — Quota & failover**
- (A) None — crash on quota/error
- (B) Retry same provider with backoff
- (C) Failover to next provider in ordered list
- (D) Dynamic routing — pick provider based on availability / tier

**M0.7 — Caching strategy**
- (A) None
- (B) Prompt caching — vendor-supported prefix caching (Anthropic, Google)
- (C) Response caching — dedup identical or near-identical requests
- (D) Tool result caching — memoize expensive tool outputs
- (E) Multi-layer — prompt + response + tool caching combined

**M0.8 — Sub-harness scope** *[meta only]*
- (A) N/A — API harness
- (B) Single CLI hardcoded (e.g. Claude Code only)
- (C) Multiple CLIs with per-agent adapters
- (D) Agent-agnostic — uniform interface, any conforming CLI

---

## M1 — Agent Loop
*The core think → act → observe execution cycle.*

**M1.1 — Loop ownership**
- (A) Fully owned — harness implements the complete tool loop itself
- (B) Fully delegated — loop runs opaquely inside sub-harness process
- (C) Partial — harness owns outer loop, delegates inner tool execution

**M1.2 — Tool execution** *(API harnesses)*
- (A) Native tool registry — harness defines and executes tools directly
- (B) MCP tool delegation — tools provided by connected MCP servers
- (C) Shell passthrough — all tools execute as bash commands
- (D) N/A — delegated to sub-harness

**M1.3 — Observation surface** *[meta only — what the meta-harness can see]*
- (A) stdout/stderr capture only
- (B) PTY raw stream (includes escape codes, requires parsing)
- (C) tmux capture-pane (polled terminal snapshot)
- (D) Hook events — PreToolUse / PostToolUse callbacks
- (E) File system polling — agent writes to known paths, supervisor reads
- (F) MCP / IPC structured events — typed messages from sub-harness
- (G) Session JSONL — sub-harness conversation file read post-run

**M1.4 — Loop termination detection**
- (A) Stop token / sentinel string in output
- (B) Process exit code
- (C) Max turn / token limit reached
- (D) Explicit completion file written by agent
- (E) Human interrupt

**M1.5 — Context rot mitigation**
- (A) None
- (B) Manual truncation
- (C) Automatic summarization / compaction within session
- (D) Loop-and-reset — fresh spawn per work unit, git as memory
- (E) Hierarchical summarization — progressive multi-level compression (recent verbatim → older summarized → oldest as bullets)
- (F) External context offloading — write context to files the agent can re-read on demand

**M1.6 — Error classification & routing**
- (A) Opaque — all errors passed to agent as text, no classification
- (B) Binary — transient (retry) vs permanent (fail), supervisor decides
- (C) Layered — agent handles tool errors, supervisor handles process/infra errors
- (D) Typed routing — error taxonomy with per-type recovery policies (retry / escalate / replan / abort)

**M1.7 — Code modification protocol**
- (A) Whole-file rewrite
- (B) Search/replace blocks
- (C) Unified diff / patch
- (D) AST-aware / tree-sitter edits
- (E) Line-range replacement
- (F) Delegated to sub-harness — meta-harness does not define edit format
- (G) Mixed — model selects format per edit

**M1.8 — Output extraction**
- (A) Freeform text — human interprets
- (B) Regex / pattern matching on stdout
- (C) JSON mode / structured output from model
- (D) Tool-use protocol (native function calling)
- (E) File convention — agent writes to known paths, supervisor reads
- (F) Exit code + file artifacts combined

---

## M2 — Session Management
*Tracking, storing, and resuming individual agent runs.*

**M2.1 — Session identity**
- (A) None — stateless, no session concept
- (B) In-memory only — lost on process exit
- (C) Persistent UUID in database
- (D) Sub-harness native session ID tracked by meta-harness

**M2.2 — Session records**
- (A) None
- (B) Raw stdout captured to flat file
- (C) Structured event log (JSONL) written by harness
- (D) Sub-harness session JSONL referenced by path

**M2.3 — Relational model**
- (A) Session in isolation
- (B) Project → session
- (C) Project → task → session
- (D) Project → task → session → invocation (full lineage)

**M2.4 — Resume strategy**
- (A) None — always fresh spawn
- (B) Native resume — `--resume {session-id}` flag
- (C) Context reconstruction — summarize prior session, inject into new spawn
- (D) Hybrid — resume if recent, reconstruct if old or compacted

**M2.5 — State persistence backend**
- (A) None
- (B) File-based checkpoint (JSON / markdown)
- (C) SQLite
- (D) External database

---

## M3 — Context Engineering
*What the agent sees at the start of each run.*

**M3.1 — Context assembly**
- (A) None — raw user prompt only
- (B) Static template with fixed fields
- (C) Dynamic assembly — pulls from multiple sources at spawn time
- (D) RAG retrieval — embeds query against memory store, injects top-K

**M3.2 — Repo awareness**
- (A) None — agent explores repo itself
- (B) Working directory path only
- (C) File tree injected (directory listing)
- (D) Symbol index — tree-sitter / LSP-based code map
- (E) Semantic search — embeddings over codebase

**M3.3 — Task specification format**
- (A) Freeform string
- (B) Structured markdown (headings: Goal / Acceptance Criteria / Constraints)
- (C) Typed schema — Zod / JSON Schema validated contract
- (D) Agent-readable file — agent is told to read a specific path

**M3.4 — Standing instructions delivery**
- (A) None
- (B) System prompt (API harness)
- (C) CLAUDE.md / AGENTS.md — vendor-specific files agent reads automatically
- (D) Canonical source → compiled to vendor files at spawn time

**M3.5 — Context budget**
- (A) None — no budget management
- (B) Soft limit — warn when approaching
- (C) Layered budget — reserve tokens for agent's own work
- (D) Dynamic — budget adjusted per model tier / context window size

**M3.6 — Mid-session steering** *[post-spawn control]*
- (A) None — prompt is fixed at spawn time
- (B) stdin injection — write to process stdin while running
- (C) tmux send-keys — inject keystrokes into tmux session
- (D) PTY master write — inject bytes into PTY
- (E) CLAUDE.md mutation — update standing instructions file mid-run
- (F) MCP message injection — send typed message via MCP/IPC channel
- (G) Interrupt + respawn — kill, amend context, relaunch

---

## M4 — Workflow Engine
*Sequencing multi-step work with transitions and conditions.*

**M4.1 — Step model**
- (A) None — single-shot execution only
- (B) Linear sequence — fixed ordered steps
- (C) DAG — steps with explicit dependencies, parallel where possible
- (D) State machine — steps with typed transitions, conditions, and guards

**M4.2 — Workflow definition**
- (A) Hardcoded — steps defined in source code only
- (B) Config file — YAML / TOML / JSON
- (C) Code DSL — programmatic composition in host language
- (D) User-customizable — repo-local overrides allowed

**M4.3 — Loops and feedback**
- (A) None — linear only
- (B) Fixed retry count on failure
- (C) Conditional loops with explicit exit criteria
- (D) Budget-enforced loops with stuck detection

**M4.4 — Pipeline composition**
- (A) None — single workflow only
- (B) Manual chaining — call next workflow explicitly in code
- (C) Declarative chain — workflow declares its successor
- (D) Dynamic routing — output content determines which workflow runs next

**M4.5 — I/O contracts**
- (A) None — implicit, undocumented
- (B) Informal documentation
- (C) Typed schema validation — Zod / JSON Schema on inputs and outputs

**M4.6 — Inter-step data protocol**
- (A) Implicit — agent reads/writes files ad hoc, no defined handoff
- (B) File-first — supervisor defines known paths, each step reads/writes to them
- (C) In-memory — supervisor holds state object, passes to each step programmatically
- (D) Database-mediated — steps read from and write to shared database tables
- (E) Environment injection — supervisor sets env vars or CLI args per step from prior outputs

---

## M5 — Process Supervision *(meta-harness)*
*Keeping sub-harness processes healthy over time.*

**M5.1 — Spawn model**
- (A) N/A — API harness
- (B) One-shot — spawn, wait for exit, handle result
- (C) Long-lived with restart — supervisor monitors and restarts on failure
- (D) Pool — N workers pre-spawned, tasks distributed

**M5.2 — Stall detection**
- (A) None — wait indefinitely
- (B) Wall-clock timeout from spawn
- (C) Output silence timeout — no new output for N seconds
- (D) Heartbeat file staleness — agent must update a file; supervisor detects lag
- (E) Composite — multiple signals combined

**M5.3 — Recovery action on stall / crash**
- (A) None — mark failed, stop
- (B) Restart with identical context
- (C) Restart with modified context (amended prompt or reduced scope)
- (D) Escalate to human gate before retry

**M5.4 — Restart budget**
- (A) None — unlimited restarts
- (B) Fixed max per task
- (C) Configurable per workflow / step
- (D) Adaptive — budget varies by error type

**M5.5 — Progress detection**
- (A) None
- (B) Output rate — bytes / lines per interval
- (C) Heartbeat content diff — is the agent making new statements?
- (D) Git activity — new commits or file changes detected

---

## M6 — Workspace Isolation
*Preventing concurrent agents from interfering with each other.*

**M6.1 — Isolation unit**
- (A) None — shared working directory
- (B) Git worktree — isolated checkout on separate branch
- (C) Docker container
- (D) Separate full clone
- (E) tmux window (process isolation only, not filesystem)
- (F) Virtual filesystem overlay — OverlayFS / copy-on-write layer, no full container

**M6.2 — Worktree lifecycle**
- (A) N/A
- (B) Manual — user creates and destroys
- (C) Auto-managed — supervisor creates before spawn, destroys after delivery
- (D) Pooled — pre-created, reused across tasks

**M6.3 — Orphan recovery**
- (A) None — orphaned worktrees accumulate
- (B) Manual cleanup commands
- (C) Automatic detection and cleanup on supervisor start

**M6.4 — Checkpoint strategy**
- (A) None
- (B) Commit at end of successful task only
- (C) Commit before each risky step
- (D) Named checkpoint tags at defined milestones

**M6.5 — Revert strategy**
- (A) None — failed state persists
- (B) Manual revert instruction to agent
- (C) Automatic hard reset to last checkpoint SHA on failure
- (D) Revert + rebuild — reset then trigger re-planning

**M6.6 — Delivery mechanism**
- (A) None — changes stay in worktree
- (B) Direct merge to target branch
- (C) PR / MR creation for human review
- (D) Cherry-pick selected commits
- (E) Human approval gate before any delivery

---

## M7 — Memory Architecture
*Knowledge persisting across sessions, agents, and runs.*

**M7.1 — Working memory scope**
- (A) None — stateless per run
- (B) In-session only — lost on process exit
- (C) Assembled from store at spawn — relevant prior knowledge injected
- (D) Continuously retrieved — agent can query memory during run

**M7.2 — Project memory store**
- (A) None
- (B) CLAUDE.md / AGENTS.md only — hand-maintained
- (C) Structured markdown files in repo — machine-maintained
- (D) Relational database (SQLite)
- (E) Vector store (LanceDB, sqlite-vec)
- (F) Version-controlled SQL (Dolt / Beads)

**M7.3 — Decision logging**
- (A) None
- (B) Append-only log — not queryable
- (C) Indexed store — queryable by file, topic, or date

**M7.4 — Learning ritual**
- (A) None — memory never updated automatically
- (B) Human manually updates memory files
- (C) Automated post-run summarization → written to memory store
- (D) Dedicated distillation agent runs after each session

**M7.5 — Retrieval mechanism**
- (A) None — no retrieval
- (B) Full injection — entire memory included every run
- (C) Keyword / FTS — search by term
- (D) Semantic / vector — search by meaning

**M7.6 — Cross-agent memory sharing**
- (A) None — each agent isolated
- (B) File-based — shared files, last-write-wins
- (C) SQLite with transactions — concurrent-safe reads and writes
- (D) CRDT / version-controlled — mergeable, conflict-free

---

## M8 — Security & Policy
*What agents are and are not permitted to do.*

**M8.1 — Hook integration**
- (A) None
- (B) PostToolUse only — observe after execution
- (C) PreToolUse only — intercept before execution
- (D) Both pre and post

**M8.2 — Policy schema**
- (A) None
- (B) Allowlist only — explicit permit list
- (C) Denylist only — explicit block list
- (D) Full allow / deny / modify — structured rules with action types

**M8.3 — Policy layering**
- (A) None — flat single policy
- (B) Two levels — global + repo
- (C) Full stack — global → repo → session → step, deny-wins

**M8.4 — Sandbox**
- (A) None — agent has full system access
- (B) File scope limits — agent constrained to specific paths
- (C) Network restrictions
- (D) Full container isolation (Docker / VM)

**M8.5 — Audit log**
- (A) None
- (B) Stdout capture only
- (C) Structured tool call log — every invocation with args, result, policy decision

**M8.6 — Secret management** *(non-model credentials agents need for work)*
- (A) None — agent accesses ambient env vars directly
- (B) Env injection — supervisor sets scoped env vars at spawn time
- (C) Secret store with scope limits — agent requests secrets via API, supervisor enforces access rules
- (D) Vault integration — external secret manager (1Password, HashiCorp Vault, etc.)

---

## M9 — Planning & Decomposition
*Breaking large work into executable units.*

**M9.1 — Decomposition method**
- (A) None — user provides atomic tasks manually
- (B) LLM-assisted with human review before execution
- (C) Automated PRD parsing — structured task graph produced without human review
- (D) Role-based — specialized agents (PM, Architect, Dev) produce the plan collaboratively

**M9.2 — Task graph**
- (A) None — flat unordered list
- (B) Ordered sequence — explicit execution order
- (C) Dependency DAG — tasks declare blockers, parallelism inferred

**M9.3 — Plan format**
- (A) None — tasks are freeform strings
- (B) Structured markdown
- (C) Typed schema (JSON / Zod)
- (D) Agent-readable contract file — agent reads it directly as context

**M9.4 — Plan invalidation**
- (A) None — plan is fixed once started
- (B) Human signals invalidation manually
- (C) Automated detection — agent writes a signal file; supervisor detects

**M9.5 — Re-planning**
- (A) None — fail on invalid plan
- (B) Human-triggered retry with amended plan
- (C) Automated revert-and-rebuild — reset to checkpoint, generate new plan
- (D) Research-chained replan — trigger research workflow before rebuilding

**M9.6 — Re-plan budget**
- (A) None — unlimited
- (B) Fixed global limit
- (C) Configurable per workflow or task type

---

## M10 — Multi-Agent Coordination
*Running multiple agents simultaneously.*

**M10.1 — Parallelism model**
- (A) None — sequential only
- (B) Parallel independent tasks — different tasks, isolated workspaces
- (C) Parallel same-task — multiple agents on identical task (consensus)
- (D) Both B and C

**M10.2 — Coordination mechanism**
- (A) None — no inter-agent communication
- (B) File-based blackboard — shared directory agents read/write
- (C) SQLite shared state — concurrent-safe, queryable
- (D) Message queue — explicit async messaging between agents
- (E) CRDT store — mergeable, version-controlled (Beads / Dolt)

**M10.3 — Consensus model**
- (A) None
- (B) First-success-wins — race, take first clean result
- (C) Majority vote — N agents vote, majority answer wins
- (D) Synthesis agent — separate agent reviews all outputs and produces unified result
- (E) Formal protocol — Raft, BFT, or similar distributed consensus algorithm

**M10.4 — Merge strategy**
- (A) None — parallel branches never merged automatically
- (B) Sequential manual merge
- (C) Automated sequential merge
- (D) Merge queue with conflict detection and resolution

**M10.5 — Inter-agent protocol**
- (A) None — proprietary / ad hoc
- (B) MCP (JSON-RPC, tool-level)
- (C) A2A (Agent-to-Agent, Google + Linux Foundation — includes former IBM ACP)
- (D) Custom RPC / message bus

---

## M11 — Daemon & Scheduling
*Running unsupervised over time across multiple sessions.*

**M11.1 — Process model**
- (A) One-shot CLI — exits after completing a single task
- (B) Interactive session — alive while user is present
- (C) Background daemon — persists across user sessions
- (D) System service — launchd / systemd managed, starts on boot

**M11.2 — Repo scope**
- (A) Single repo only
- (B) Multi-repo — global daemon managing N repos

**M11.3 — Trigger model**
- (A) Manual CLI invocation only
- (B) Cron / time-scheduled (e.g. overnight run)
- (C) Event-driven — webhook, GitHub label, Linear label
- (D) Chat dispatch — Telegram / Slack message triggers run
- (E) Multiple trigger types combined

**M11.4 — Daemon self-recovery**
- (A) None — restart loses all in-flight state
- (B) File checkpoint — reconstruct from state files on restart
- (C) Database reconstruction — query SQLite to recover in-flight tasks
- (D) Full state machine snapshot restore (XState / equivalent)

---

## M12 — Human Interface & Gates
*How humans interact with, supervise, and access the harness.*

**M12.1 — Autonomy model**
- (A) Fully autonomous — no human checkpoints
- (B) Approve-before-start — human reviews plan, then execution is autonomous
- (C) Fixed checkpoint gates — specific steps always require human approval
- (D) Configurable gates — autonomy level set per step, per workflow, per task

**M12.2 — Notification**
- (A) None
- (B) Terminal output only
- (C) OS system notification
- (D) External channel — Telegram / Slack / email

**M12.3 — Review surface**
- (A) None — agent output viewed in terminal
- (B) TUI dashboard — terminal UI with status panels
- (C) Desktop GUI — native app
- (D) Web UI — browser-based dashboard
- (E) Chat interface — review via Telegram / Slack thread
- (F) PR / MR — pull request itself as the review and feedback interface

**M12.4 — Autonomy switching**
- (A) None — fixed at config time
- (B) Per-run config — set before starting
- (C) Mid-session — can change autonomy level on a running session

**M12.5 — Primary interaction surface**
- (A) CLI commands only — all interaction via terminal commands and flags
- (B) TUI — persistent terminal UI with panels, status views, and keyboard navigation
- (C) Desktop GUI — native app window (Electron, Tauri, Swift, etc.)
- (D) Web dashboard — browser-based, self-hosted or SaaS
- (E) IDE-embedded — panel or sidebar inside an editor (VS Code, JetBrains, etc.)
- (F) Chat interface — Telegram / Slack / Discord as the primary operating surface
- (G) Multiple surfaces — CLI + GUI + web all first-class, not just one primary

**M12.6 — Deployment model**
- (A) Global CLI binary — npm / brew / cargo install, runs locally
- (B) Project-local — installed per-repo as dev dependency
- (C) Desktop app — .dmg / .exe / .AppImage with installer
- (D) Self-hosted server — Docker / binary on user's infra, accessed via web UI
- (E) SaaS — vendor-hosted, accessed via browser
- (F) IDE plugin — distributed via extension marketplace (VS Code, JetBrains)

**M12.7 — Real-time session visibility**
- (A) None — only see results after completion
- (B) Log tailing — stream stdout / logs in another terminal
- (C) Live TUI — real-time status panels showing current step, output, progress
- (D) Live web dashboard — browser-based real-time view
- (E) Attached terminal — can attach to the agent's actual terminal session (tmux attach)

**M12.8 — Client-agent protocol**
- (A) None — proprietary / custom protocol between client and agent
- (B) ACP (Agent Client Protocol) — standardized JSON-RPC 2.0 over stdio, the "LSP for coding agents" (Zed, JetBrains, Goose, Gemini CLI, Copilot CLI)
- (C) LSP-extended — Language Server Protocol with AI/agent extensions
- (D) Custom JSON-RPC — non-standard JSON-RPC variant
- (E) REST API — HTTP server exposed by agent, client connects via HTTP

---

## M13 — Observability & Telemetry
*How the system exposes its internal state to operators and tooling.*

**M13.1 — Token / cost accounting**
- (A) None
- (B) Per-session totals — aggregate token count logged after each run
- (C) Per-step granular — tokens tracked per workflow step for budget enforcement
- (D) Real-time streaming — live token counters available during execution

**M13.2 — Metrics exposure**
- (A) None — operator reads logs manually
- (B) Structured log events — machine-parseable (JSON) but no metrics endpoint
- (C) Metrics endpoint — Prometheus / StatsD / health check route
- (D) Dashboard integration — built-in or pre-configured Grafana / Datadog / etc.

**M13.3 — Trace correlation**
- (A) None — each session/step logged independently
- (B) Session-level trace ID — all events in one run share an ID
- (C) Pipeline-level trace — trace spans across workflow steps within a pipeline
- (D) Cross-agent distributed trace — correlated spans across parallel agents and sub-harnesses

**M13.4 — Status reporting**
- (A) None — operator polls logs
- (B) Exit summary — report written on completion
- (C) Live status — queryable endpoint or file showing current step, progress, errors
- (D) Push-based — proactive status updates to external channel (Telegram / webhook / Slack)

---

## M14 — Extensibility & Plugin Model
*How users and third parties extend harness capabilities.*

**M14.1 — Extension surface**
- (A) None — monolithic, no extension points
- (B) Tools only — users can register custom tools or MCP servers
- (C) Workflow steps — users can add custom step types to workflows
- (D) Full pipeline — tools + steps + providers + hooks all extensible

**M14.2 — Extension format**
- (A) N/A — not extensible
- (B) Config-declared — extensions defined in YAML / JSON (e.g. MCP server URLs, shell hook paths)
- (C) Code plugins — host-language modules loaded at runtime (TypeScript / Python)
- (D) Containerized — extensions run in isolated containers with defined I/O

**M14.3 — Extension isolation**
- (A) N/A — not extensible
- (B) None — extensions run in harness process, full access
- (C) Process boundary — extensions run as separate processes
- (D) Sandboxed — extensions have resource limits, scoped filesystem, no ambient credentials

**M14.4 — Extension lifecycle**
- (A) N/A — not extensible
- (B) Static — loaded at startup, requires restart to change
- (C) Hot-reload — extensions can be added or updated without restarting
- (D) Versioned — extensions declare compatibility ranges, harness validates on load

---

## M15 — Verification & Quality Gates
*How agent output is validated before it is considered done or delivered.*

**M15.1 — Verification method**
- (A) None — agent output accepted as-is
- (B) Test suite execution — automated tests run after code changes
- (C) Lint / typecheck gate — static analysis must pass before delivery
- (D) Self-review — agent reviews its own diff before submitting
- (E) Blind validation — independent validator agent that never sees implementer's context
- (F) Multi-agent review — one agent reviews another's work (not consensus — sequential review)
- (G) Combined — multiple verification methods applied in sequence

**M15.2 — Gate placement**
- (A) None — no gates
- (B) Post-step — verification after each workflow step
- (C) Pre-commit — verification before code is committed
- (D) Pre-delivery — verification before PR creation or branch merge
- (E) Pre-merge — verification after PR creation, before merge to target branch
- (F) Multiple — gates at several points in the pipeline

**M15.3 — Failure action**
- (A) None — verification failure ignored
- (B) Retry same agent — re-run with error feedback appended
- (C) Replan — revert to checkpoint, generate new plan
- (D) Escalate — notify human or transfer to a different agent
- (E) Abort — mark task as failed, stop execution

**M15.4 — Verification budget**
- (A) None — unlimited verification attempts
- (B) Fixed retry count
- (C) Configurable per step or workflow
- (D) Adaptive — budget varies by failure type or verification method
