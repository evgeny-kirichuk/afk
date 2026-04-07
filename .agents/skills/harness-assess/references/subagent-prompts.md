# Subagent Task Templates

Spawn 7 subagents, one per module cluster. Each subagent explores independently and returns structured results.

**How to spawn:** Use the Task tool or `claude -p` subprocess — whichever is available. If neither is available, execute the 7 tasks sequentially yourself following the same structure.

**Every subagent prompt gets these common instructions prepended:**

```
You are exploring a coding agent harness codebase to assess its architecture.

REPO: {repo_path}
TOOL NAME: {tool_name}
HARNESS TYPE: {H.1 assessment from Phase 1}
LANGUAGE: {language detected in recon}

RECON SUMMARY:
{paste the recon.sh output here}

RULES:
1. GREP BEFORE READ. Never open a file to browse. Search first, read targeted ±15 line ranges.
2. Use: rg --type-not=json -g '!node_modules' -g '!dist' -g '!build' -g '!vendor' -g '!.git'
3. For each concept, report: OPTION LETTER | CONFIDENCE (HIGH/MED/LOW) | file:line evidence
4. If no evidence found after searching, report: ? | LOW | "searched: [patterns tried]"
5. Do NOT guess. Absence of evidence for a feature = option A (none) with MED confidence.
6. Keep your total output under 3000 tokens. Be terse.

OUTPUT FORMAT (strict):
---
CLUSTER: {cluster name}
CONCEPTS:
- {concept_id}: {option_letter} | {confidence} | {file:line or explanation}
- ...
ARCHITECTURE:
- {concept_id}: {file_path}:{line_range} — {one-line description}
- ...
NOTES:
- {any cross-references or uncertainties}
---
```

---

## Cluster 1: Model Interface + Agent Loop (M0, M1)

*How the harness reaches models and runs the agent cycle.*

```
TASK: Assess M0 (Model Interface) and M1 (Agent Loop).

CONCEPTS TO ASSESS:
M0.1 Transport — How does this tool talk to models or sub-harnesses? (includes ACP — Agent Client Protocol)
M0.2 Auth — How are credentials managed?
M0.3 Provider scope — Single vendor or multi-vendor?
M0.4 Model selection — Hardcoded, config, or capability tiers?
M0.5 Streaming — How is model output consumed?
M0.6 Quota & failover — Retry, failover, or crash?
M0.7 Caching strategy — Prompt caching, response caching, tool result caching, or none?
M0.8 Sub-harness scope — (meta only) Single CLI, multiple with adapters, or agent-agnostic?
M1.1 Loop ownership — Does this tool own the agent loop or delegate it?
M1.2 Tool execution — Native tools, MCP, shell, or delegated?
M1.3 Observation surface — What can the supervisor see? (meta-harness only)
M1.4 Loop termination — How does it know the agent is done?
M1.5 Context rot — How is context window exhaustion handled?
M1.6 Error classification — How are errors categorized and routed?
M1.7 Code modification protocol — How does the agent edit code? Whole-file, search/replace, diff, AST, or delegated?
M1.8 Output extraction — How is structured data extracted from agent output? JSON, regex, tool-use, files?

SEARCH STRATEGY:
1. Find the main spawn/API-call code: rg "spawn|fetch.*api|Anthropic|OpenAI|create.*message"
2. Trace the data flow from spawn to result collection
3. Look for retry/error handling around the model call
4. Check for streaming parsers (NDJSON, SSE, line readers)
5. Find the main loop construct or process-wait logic
6. Look for tool registration or tool dispatch code
7. Check for caching: rg "cache|memoize|prompt.*cache|cache_control"
8. Find edit format logic: rg "search.*replace|diff|patch|edit.*format|EditFormat"
9. Find output parsing: rg "parse.*output|json.*mode|structured.*output|--json"
10. (Meta only) Check which CLIs are supported: rg "claude|codex|gemini|aider" and look for adapter patterns
```

---

## Cluster 2: Session Management + Memory (M2, M7)

*How state persists across and within runs.*

```
TASK: Assess M2 (Session Management) and M7 (Memory Architecture).

CONCEPTS TO ASSESS:
M2.1 Session identity — How are sessions identified?
M2.2 Session records — What gets recorded per session?
M2.3 Relational model — Session hierarchy (flat, project→session, deeper?)
M2.4 Resume strategy — Can sessions be resumed?
M2.5 State persistence — SQLite, files, or external DB?
M7.1 Working memory — What knowledge is available during a run?
M7.2 Project memory store — Where is cross-session knowledge stored?
M7.3 Decision logging — Are decisions recorded and queryable?
M7.4 Learning ritual — Does the system update its own memory?
M7.5 Retrieval — How is stored knowledge retrieved?
M7.6 Cross-agent sharing — How do parallel agents share state?

SEARCH STRATEGY:
1. Find database/storage code: rg "sqlite|database|persist|checkpoint|session"
2. Find session creation and tracking: rg "session.*id|uuid|create.*session"
3. Check for memory/knowledge files: find . -name "*memory*" -o -name "*knowledge*"
4. Look for JSONL/transcript writing: rg "jsonl|transcript|append.*log"
5. Check for resume/restore logic: rg "resume|restore|reconstruct"
6. Look for distillation or summarization post-run: rg "distill|summarize.*session|post.*run"
```

---

## Cluster 3: Context Engineering + Planning (M3, M9)

*What agents see and how work gets decomposed.*

```
TASK: Assess M3 (Context Engineering) and M9 (Planning & Decomposition).

CONCEPTS TO ASSESS:
M3.1 Context assembly — How is the agent's initial context built?
M3.2 Repo awareness — What does the agent know about the codebase?
M3.3 Task spec format — How are tasks specified?
M3.4 Standing instructions — How are persistent instructions delivered?
M3.5 Context budget — Is token usage managed?
M3.6 Mid-session steering — Can the operator intervene mid-run?
M9.1 Decomposition — How is large work broken down?
M9.2 Task graph — Flat list, sequence, or DAG?
M9.3 Plan format — Freeform, markdown, or typed schema?
M9.4 Plan invalidation — Can a plan be invalidated mid-execution?
M9.5 Re-planning — What happens when a plan fails?
M9.6 Re-plan budget — Are re-planning attempts limited?

SEARCH STRATEGY:
1. Find prompt/context building code: rg "system.*prompt|context.*build|assemble|template"
2. Find CLAUDE.md/AGENTS.md handling: rg "CLAUDE\.md|AGENTS\.md|instructions.*file"
3. Look for task schema definitions: rg "task.*schema|TaskSpec|task.*format"
4. Find planning/decomposition code: rg "plan|decompos|breakdown|PRD|task.*graph"
5. Check for re-planning triggers: rg "replan|invalidat|amend.*plan"
6. Look for steering mechanisms: rg "stdin.*write|send-keys|inject|interrupt"
```

---

## Cluster 4: Workflow Engine + Process Supervision (M4, M5)

*How multi-step work is sequenced and processes kept healthy.*

```
TASK: Assess M4 (Workflow Engine) and M5 (Process Supervision).

CONCEPTS TO ASSESS:
M4.1 Step model — Single-shot, linear, DAG, or state machine?
M4.2 Workflow definition — Hardcoded, config file, DSL, or user-customizable?
M4.3 Loops and feedback — Fixed retry, conditional loops, or budget-enforced?
M4.4 Pipeline composition — Single workflow or chained?
M4.5 I/O contracts — Implicit, documented, or schema-validated?
M4.6 Inter-step data protocol — How does state flow between steps?
M5.1 Spawn model — One-shot, long-lived with restart, or pool? (meta only)
M5.2 Stall detection — Timeout, heartbeat, output silence, or composite? (meta only)
M5.3 Recovery action — Restart identical, restart modified, or escalate? (meta only)
M5.4 Restart budget — Unlimited, fixed, or configurable? (meta only)
M5.5 Progress detection — Output rate, heartbeat diff, or git activity? (meta only)

SEARCH STRATEGY:
1. Find state machine or workflow definitions: rg "createMachine|xstate|StateMachine|workflow"
2. Look for YAML workflow configs: find . -name "*.yaml" -name "*.yml" | xargs rg "step|stage|phase"
3. Find step execution logic: rg "step|Step|execute.*step|run.*step"
4. Check for stall/timeout detection: rg "timeout|stall|watchdog|heartbeat"
5. Find restart/recovery logic: rg "restart|recover|respawn|retry.*task"
6. Look for inter-step data passing: rg "handoff|state.*pass|step.*context|accumulated"
```

---

## Cluster 5: Workspace Isolation + Multi-Agent (M6, M10)

*How agents are isolated and coordinated.*

```
TASK: Assess M6 (Workspace Isolation) and M10 (Multi-Agent Coordination).

CONCEPTS TO ASSESS:
M6.1 Isolation unit — Shared dir, worktree, container, or overlay?
M6.2 Worktree lifecycle — Manual, auto-managed, or pooled?
M6.3 Orphan recovery — None, manual, or automatic?
M6.4 Checkpoint strategy — None, end-of-task, per-step, or milestone tags?
M6.5 Revert strategy — None, manual, auto-reset, or revert+rebuild?
M6.6 Delivery — None, direct merge, PR, cherry-pick, or approval gate?
M10.1 Parallelism — Sequential, parallel independent, parallel same-task, or both?
M10.2 Coordination — None, blackboard, SQLite, message queue, or CRDT?
M10.3 Consensus — None, first-success, majority vote, synthesis agent, or formal protocol (Raft/BFT)?
M10.4 Merge strategy — None, manual, auto sequential, or merge queue?
M10.5 Inter-agent protocol — None, MCP, A2A, or custom RPC?

SEARCH STRATEGY:
1. Find git worktree operations: rg "worktree|git.*worktree"
2. Find container/docker usage: rg "docker|Docker|container|Container"
3. Check for parallel execution: rg "parallel|concurrent|Promise\.all|gather|spawn.*multiple"
4. Find merge/PR creation: rg "pull.*request|merge|create.*pr|octokit"
5. Look for coordination mechanisms: rg "blackboard|shared.*state|message.*queue|channel"
6. Find checkpoint/revert: rg "checkpoint|revert|reset.*hard|rollback"
7. Find inter-agent protocols: rg "A2A|agent2agent|MCP|agent.*protocol|json.rpc"
```

---

## Cluster 6: Security + Observability + Extensibility + Verification (M8, M13, M14, M15)

*Cross-cutting concerns: policy, telemetry, plugins, and quality gates.*

```
TASK: Assess M8 (Security & Policy), M13 (Observability & Telemetry), M14 (Extensibility & Plugin Model), and M15 (Verification & Quality Gates).

CONCEPTS TO ASSESS:
M8.1 Hook integration — Pre/post tool hooks?
M8.2 Policy schema — Allow/deny rules?
M8.3 Policy layering — Flat, two-level, or full stack?
M8.4 Sandbox — File limits, network limits, or container?
M8.5 Audit log — None, stdout, or structured log?
M8.6 Secret management — Ambient env, scoped injection, store, or vault?
M13.1 Token/cost accounting — None, per-session, per-step, or real-time?
M13.2 Metrics exposure — None, structured logs, metrics endpoint, or dashboard?
M13.3 Trace correlation — None, session-level, pipeline-level, or cross-agent?
M13.4 Status reporting — None, exit summary, live status, or push-based?
M14.1 Extension surface — None, tools only, steps, or full pipeline?
M14.2 Extension format — Config, code plugins, or containerized?
M14.3 Extension isolation — None, process boundary, or sandboxed?
M14.4 Extension lifecycle — Static, hot-reload, or versioned?
M15.1 Verification method — None, test suite, lint/typecheck, self-review, blind validation, multi-agent review, or combined?
M15.2 Gate placement — None, post-step, pre-commit, pre-delivery, pre-merge, or multiple?
M15.3 Failure action — None, retry with feedback, replan, escalate, or abort?
M15.4 Verification budget — Unlimited, fixed, configurable, or adaptive?

SEARCH STRATEGY:
1. Find hook/middleware code: rg "hook|Hook|PreToolUse|PostToolUse|intercept|middleware"
2. Find policy definitions: rg "policy|allow|deny|permission|sandbox"
3. Check for audit logging: rg "audit|tool.*log|structured.*log|action.*record"
4. Find secret handling: rg "secret|vault|keyring|credential|env.*inject"
5. Look for metrics/telemetry: rg "metric|token.*count|usage|cost|trace|span"
6. Find plugin/extension system: rg "plugin|extension|registry|register|addon"
7. Find verification/quality gates: rg "verif|validat|quality.*gate|lint|typecheck|test.*pass|review.*agent"
8. Find gate placement: rg "pre.*commit|pre.*merge|pre.*delivery|post.*step|step.*gate"
9. Find verification failure handling: rg "retry.*on.*fail|replan.*on.*fail|abort.*on.*fail"
```

---

## Cluster 7: Daemon + Human Interface (M11, M12)

*Operational model, human interaction, and UX surface.*

```
TASK: Assess M11 (Daemon & Scheduling) and M12 (Human Interface & Gates).

CONCEPTS TO ASSESS:
M11.1 Process model — One-shot, interactive, daemon, or system service?
M11.2 Repo scope — Single repo or multi-repo?
M11.3 Trigger model — Manual, cron, event-driven, chat, or combined?
M11.4 Daemon recovery — None, file checkpoint, DB reconstruction, or state machine snapshot?
M12.1 Autonomy model — Fully autonomous, approve-before-start, fixed gates, or configurable?
M12.2 Notification — None, terminal, OS notification, or external channel?
M12.3 Review surface — Terminal, TUI, GUI, web UI, chat, or PR?
M12.4 Autonomy switching — Fixed, per-run, or mid-session?
M12.5 Primary interaction surface — CLI, TUI, desktop GUI, web dashboard, IDE, chat, or multiple?
M12.6 Deployment model — Global CLI, project-local, desktop app, self-hosted, SaaS, or IDE plugin?
M12.7 Real-time session visibility — None, log tailing, live TUI, live web dashboard, or tmux attach?
M12.8 Client-agent protocol — None, ACP (Agent Client Protocol), LSP-extended, custom JSON-RPC, or REST API?

SEARCH STRATEGY:
1. Find daemon/service code: rg "daemon|service|launchd|systemd|background|detach"
2. Look for service unit files: find . -name "*.plist" -o -name "*.service"
3. Find scheduling: rg "cron|schedule|interval|timer|trigger"
4. Find gate/approval logic: rg "gate|approval|confirm|human.*review|checkpoint"
5. Check for notification: rg "notify|telegram|slack|email|push.*notification"
6. Find TUI/web UI code: rg "tui|TUI|dashboard|http.*server|express|ink|bubbletea"
7. Find autonomy configuration: rg "autonom|permission|skip.*permission|dangerously"
8. Detect UI framework: rg "electron|tauri|blessed|ink|bubbletea|ratatui|textual"
9. Check deployment: find . -maxdepth 2 -name "Dockerfile" -o -name "docker-compose*" -o -name "*.plist" -o -name "tauri.conf*"
10. Check for live visibility: rg "tmux.*attach|WebSocket|socket\.io|live.*update|spinner|progress.*bar"
11. Find client-agent protocol: rg "acp|ACP|agent.*client.*protocol|agentclientprotocol|json.rpc"
12. Read README.md first 80 lines — it almost always states what kind of tool this is (CLI/TUI/app/platform)
```

---

## Collecting results

After all 7 subagents complete, the parent agent must:

1. **Parse each cluster output** — extract concept assessments and architecture entries
2. **Cross-validate** — check for contradictions between clusters (e.g., Cluster 1 says pipe spawn but Cluster 5 says tmux isolation)
3. **Merge into single matrix** — combine all concepts into one table sorted by module
4. **Merge architecture maps** — combine all file references into one document sorted by module
5. **Flag uncertainties** — collect all `?` and `LOW` confidence items into a "needs verification" section
