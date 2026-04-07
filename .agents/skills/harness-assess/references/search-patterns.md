# Search Patterns Reference

Per-module search strategies for exploring a harness codebase. Every pattern uses `rg` (ripgrep). If unavailable, substitute `grep -rn`.

## Table of contents
- [Universal exclusions](#universal-exclusions)
- [H.1 — Harness type](#h1--harness-type)
- [M0 — Model Interface](#m0--model-interface)
- [M1 — Agent Loop](#m1--agent-loop)
- [M2 — Session Management](#m2--session-management)
- [M3 — Context Engineering](#m3--context-engineering)
- [M4 — Workflow Engine](#m4--workflow-engine)
- [M5 — Process Supervision](#m5--process-supervision)
- [M6 — Workspace Isolation](#m6--workspace-isolation)
- [M7 — Memory Architecture](#m7--memory-architecture)
- [M8 — Security & Policy](#m8--security--policy)
- [M9 — Planning & Decomposition](#m9--planning--decomposition)
- [M10 — Multi-Agent Coordination](#m10--multi-agent-coordination)
- [M11 — Daemon & Scheduling](#m11--daemon--scheduling)
- [M12 — Human Interface & Gates](#m12--human-interface--gates)
- [M13 — Observability & Telemetry](#m13--observability--telemetry)
- [M14 — Extensibility & Plugin Model](#m14--extensibility--plugin-model)
- [M15 — Verification & Quality Gates](#m15--verification--quality-gates)
- [Cross-cutting patterns](#cross-cutting-patterns)

---

## Universal exclusions

All patterns below use `$RG` as the search command. Set it at the start of each subagent session:

```bash
RG="rg --type-not=json -g '!node_modules' -g '!dist' -g '!build' -g '!vendor' -g '!.git' -g '!*.min.*' -g '!*.lock'"
```

**Exploration protocol per concept:**
1. Run the listed grep patterns
2. For each hit, read a ±15 line range around it: `sed -n '<start>,<end>p' <file>`
3. If no hits, check the "fallback" patterns
4. If still nothing, record `?` with a note on what was searched

---

## H.1 — Harness type

Determine this first. It gates which modules apply.

```bash
# Meta-harness signals: spawning other CLI tools
$RG -l "spawn|exec|fork|child_process|Bun\.spawn|subprocess" --type=ts --type=py --type=rs --type=go
$RG "claude|codex|gemini|copilot|aider|cursor" --type=ts --type=py  # CLI binary names
$RG "tmux|send-keys|capture-pane"

# API harness signals: direct model API calls
$RG "api\.anthropic|api\.openai|generativelanguage\.googleapis"
$RG "ChatCompletion|messages\.create|generateContent"

# MCP plugin signals
$RG "mcp|McpServer|tool_use|json-rpc"

# IDE extension signals
$RG "vscode\.workspace|extension\.ts|activate\("
```

**Decision logic:**
- Spawns CLI binaries (claude, codex, etc.) → B (Meta-harness)
- Calls model APIs directly → A (API harness)
- Both → C (Hybrid)
- Runs as MCP server → D (MCP plugin)
- VS Code extension API → E (IDE extension)
- Multiple layers → F (Platform)

---

## M0 — Model Interface

### M0.1 Transport
```bash
# API/SDK
$RG "fetch\(.*api\.|axios|httpx|reqwest|net/http" 
$RG "Anthropic\(|OpenAI\(|new.*Client"           # SDK wrappers
$RG "WebSocket|ws://|wss://"                       # WebSocket
$RG "grpc|protobuf|\.proto"                        # gRPC

# Process spawn
$RG "spawn|Bun\.spawn|child_process|subprocess\.Popen|Command::new"
$RG "forkpty|openpty|pty\.spawn|node-pty"          # PTY specifically
$RG "stdin|stdout|pipe|PIPE"                       # Pipe spawn
$RG "tmux new|tmux send|send-keys|capture-pane"   # tmux

# MCP
$RG "stdio_server|sse_server|McpServer|mcp_servers"

# ACP (Agent Client Protocol)
$RG "acp|ACP|agent.*client.*protocol|agentclientprotocol"
$RG "acp.*server|AcpServer|acp.*handler"
```
**Note:** ACP (Agent Client Protocol, Zed/Block) uses JSON-RPC 2.0 over stdio — same transport as MCP but different protocol. Check if the tool explicitly implements or references ACP → J.

### M0.2 Auth
```bash
$RG "API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|api.key|apiKey"
$RG "oauth|OAuth|credential|login|auth.*token"
$RG "keychain|credential.store|\.claude|\.config"
```
**Fallback:** Check if the tool spawns CLIs without passing API keys — that's credential inheritance (C).

### M0.3 Provider scope
```bash
$RG "provider|Provider|model.*config|ModelConfig"
$RG -l "anthropic|openai|google|mistral|ollama|groq" --type=ts --type=py
```
Count how many distinct providers are referenced. Check config schemas for provider arrays vs single provider fields.

### M0.4 Model selection
```bash
$RG "model.*:.*claude|model.*:.*gpt|model.*:.*gemini"  # hardcoded strings
$RG "tier|capability|frontier|standard|fast"             # capability tiers
$RG "model.*catalog|model.*registry|ModelCatalog"        # registries
```

### M0.5 Streaming
```bash
$RG "SSE|EventSource|text/event-stream"
$RG "NDJSON|ndjson|output-format.*json|--output-format"
$RG "readline|createInterface|line.*event"               # line-buffered stdout
$RG "capture-pane|tmux.*capture"                         # tmux polling
```

### M0.6 Quota & failover
```bash
$RG "retry|backoff|exponential|rate.limit|429|quota"
$RG "failover|fallback.*provider|next.*provider"
$RG "circuit.breaker|health.check"
```

### M0.7 Caching strategy
```bash
$RG "cache|Cache|caching|prompt.*cache|prefix.*cache"
$RG "memoize|memoiz|dedup|deduplic"
$RG "cache.*hit|cache.*miss|cache.*ttl|invalidat.*cache"
$RG "anthropic.*cache|ephemeral|cache_control"  # Anthropic prompt caching
```
**Decision logic:** Vendor prompt caching (cache_control, ephemeral) → B. Identical request dedup → C. Tool result memoization → D. Multiple → E.

### M0.8 Sub-harness scope *(meta only)*
```bash
# Which CLIs does it spawn?
$RG "claude|codex|gemini|aider|copilot|cursor|goose" --type=ts --type=py --type=rs --type=go
$RG "provider|adapter|runtime|Runtime|AgentRuntime" --type=ts --type=py
$RG "agent.*type|agent.*kind|agent.*name|binary.*path"
```
**Decision logic:** Only one CLI name found → B. Multiple with adapter/config per agent → C. Abstract interface any CLI can satisfy → D.

---

## M1 — Agent Loop

### M1.1 Loop ownership
```bash
$RG "while.*true|loop\s*\{|agent.*loop|run.*loop|agentic.*loop"
$RG "tool.*call|function.*call|tool_use|tool_result"     # owns tool loop
```
If the tool spawns CLIs and waits for exit → B (delegated). If it processes tool calls itself → A (owned).

### M1.2 Tool execution
```bash
$RG "registerTool|addTool|tool.*registry|ToolRegistry"
$RG "mcp.*tool|McpClient|list_tools"
$RG "exec\(|shell\(|bash.*-c|Bun\.\$"                   # shell passthrough
```

### M1.3 Observation surface
```bash
$RG "stdout|stderr|on\(.*data|pipe\("                    # stdout capture
$RG "PreToolUse|PostToolUse|hook|Hook"                    # hook events
$RG "watch|chokidar|fs\.watch|poll.*file"                 # file system polling
$RG "capture-pane"                                         # tmux
$RG "jsonl|\.jsonl|readSession"                           # session JSONL
```

### M1.4 Loop termination
```bash
$RG "exit.*code|process\.exit|exitCode|return.*code"
$RG "max.*turn|max.*iteration|MAX_TURNS|token.*limit"
$RG "sentinel|done.*marker|completion.*file"
$RG "interrupt|SIGINT|SIGTERM|kill"
```

### M1.5 Context rot
```bash
$RG "compact|summarize|compress|truncat|context.*window"
$RG "prune|evict|sliding.*window|token.*budget"
$RG "offload|externalize|context.*file"
```

### M1.6 Error classification & routing
```bash
$RG "error.*class|ErrorType|error.*kind|error.*category"
$RG "retryable|transient|permanent|fatal"
$RG "escalat|recover|replan.*on.*error"
```

### M1.7 Code modification protocol
```bash
$RG "search.*replace|SEARCH|REPLACE|edit.*block|EditBlock"
$RG "whole.*file|file.*rewrite|write.*file"
$RG "diff|patch|unified.*diff|udiff|apply.*patch"
$RG "tree.sitter|treesitter|AST|ast.*edit|syntax.*tree"
$RG "line.*range|start.*line|end.*line|line.*edit"
$RG "edit.*format|EditFormat|edit.*mode|EditMode"
```
**Decision logic:** Check if the harness defines how code gets modified. Meta-harnesses that delegate entirely → F. Look for format selection logic → G.

### M1.8 Output extraction
```bash
$RG "parse.*output|extract.*result|parse.*response|OutputParser"
$RG "json.*mode|structured.*output|response_format|json_object"
$RG "tool_use|tool_calls|function.*call.*result"
$RG "regex|pattern.*match|extract.*from.*stdout"
$RG "result.*file|output.*file|artifact.*path|completion.*file"
$RG "--json|--output-format|output.*format"
```

---

## M2 — Session Management

### M2.1–M2.2 Session identity & records
```bash
$RG "session.*id|sessionId|session_id|uuid|nanoid|ulid"
$RG "jsonl|transcript|session.*log|event.*log"
$RG "session.*path|session.*dir|\.claude/projects"
```

### M2.3 Relational model
```bash
$RG "project.*session|task.*session|invocation|lineage"
$RG "parent.*id|parentId|belongs.*to|foreign.*key"
```
Also check database schema files for table relationships.

### M2.4 Resume strategy
```bash
$RG "resume|--resume|--continue|restore.*session"
$RG "reconstruct|replay|context.*reconstruction"
```

### M2.5 State persistence
```bash
$RG "sqlite|better-sqlite3|libsql|rusqlite|sqlite3"
$RG "checkpoint|state.*file|persist|serialize.*state"
$RG "redis|postgres|mongo|dynamo"                        # external DB
```

---

## M3 — Context Engineering

### M3.1 Context assembly
```bash
$RG "system.*prompt|assemble.*context|build.*context|context.*builder"
$RG "template|inject|compile.*prompt"
$RG "rag|retriev|embed|vector.*search|top.k"
```

### M3.2 Repo awareness
```bash
$RG "tree-sitter|treesitter|LSP|language.*server|symbol"
$RG "file.*tree|directory.*listing|list.*files"
$RG "embed.*code|code.*search|semantic.*search"
$RG "CLAUDE\.md|AGENTS\.md|\.cursorrules|\.clinerules"
```

### M3.3 Task spec format
```bash
$RG "task.*schema|TaskSchema|task.*spec|TaskSpec"
$RG "acceptance.*criteria|goal.*constraint"
$RG "zod.*task|z\.object.*task|taskSchema"
```

### M3.4 Standing instructions
```bash
$RG "CLAUDE\.md|AGENTS\.md|rules.*file|instructions.*file"
$RG "system.*prompt|system_prompt|systemPrompt"
$RG "compile.*instructions|canonical.*source"
```

### M3.5 Context budget
```bash
$RG "token.*budget|context.*budget|max.*tokens|token.*limit"
$RG "reserve|budget.*layer|context.*window.*size"
```

### M3.6 Mid-session steering
```bash
$RG "stdin.*write|write.*stdin|process\.stdin"
$RG "send-keys|send_keys|tmux.*send"
$RG "mutate.*claude|update.*instructions|inject.*message"
$RG "interrupt.*respawn|kill.*restart|SIGINT.*restart"
```

---

## M4 — Workflow Engine

### M4.1 Step model
```bash
$RG "step|Step|phase|Phase|stage|Stage"
$RG "state.*machine|xstate|StateMachine|createMachine"
$RG "dag|DAG|dependency.*graph|topological"
$RG "sequence|sequential|pipeline|Pipeline"
```

### M4.2 Workflow definition
```bash
$RG -g "*.yaml" -g "*.yml" -g "*.toml" "workflow|step|pipeline"
$RG "workflow.*config|WorkflowConfig|load.*workflow"
$RG "dsl|DSL|compose|builder.*pattern"
```
Also: `find <repo> -name "*.yaml" -o -name "*.yml" | head -20` — check for workflow YAML files.

### M4.3 Loops and feedback
```bash
$RG "retry|max.*retry|retry.*count|retry.*budget"
$RG "loop.*exit|break.*condition|stuck.*detect"
$RG "iteration.*limit|MAX_ITERATIONS|loop.*guard"
```

### M4.4 Pipeline composition
```bash
$RG "chain|Chain|pipeline.*compose|next.*workflow|successor"
$RG "dynamic.*route|route.*based.*on|conditional.*workflow"
```

### M4.5 I/O contracts
```bash
$RG "input.*schema|output.*schema|StepInput|StepOutput"
$RG "contract|Contract|validate.*input|validate.*output"
```

### M4.6 Inter-step data protocol
```bash
$RG "state.*pass|handoff|hand.*off|step.*context|accumulated.*state"
$RG "file.*protocol|output.*path.*input.*path"
$RG "step.*result.*next.*step|pipeline.*state"
```

---

## M5 — Process Supervision

Skip entirely if H.1 = A (pure API harness).

### M5.1 Spawn model
```bash
$RG "spawn|Spawn|worker|Worker|pool|Pool"
$RG "restart|Restart|respawn|monitor.*process"
```

### M5.2 Stall detection
```bash
$RG "timeout|Timeout|stall|Stall|hang|watchdog"
$RG "heartbeat|Heartbeat|keepalive|last.*activity"
$RG "silence.*timeout|output.*timeout|idle.*timeout"
```

### M5.3–M5.4 Recovery & restart budget
```bash
$RG "recover|Recovery|restart.*on.*fail|crash.*handler"
$RG "max.*restart|restart.*limit|retry.*budget|attempt.*count"
$RG "escalat|human.*gate|fallback.*action"
```

### M5.5 Progress detection
```bash
$RG "progress|Progress|git.*diff|commit.*detect|file.*change"
$RG "output.*rate|bytes.*per|lines.*per"
$RG "heartbeat.*content|content.*diff"
```

---

## M6 — Workspace Isolation

### M6.1 Isolation unit
```bash
$RG "worktree|git.*worktree|git worktree"
$RG "docker|Docker|container|Container"
$RG "overlay|OverlayFS|copy.on.write"
$RG "clone.*repo|fresh.*clone|separate.*clone"
```

### M6.2–M6.3 Worktree lifecycle & orphan recovery
```bash
$RG "worktree.*add|worktree.*remove|worktree.*prune"
$RG "cleanup|orphan|stale.*worktree|gc.*worktree"
```

### M6.4–M6.5 Checkpoint & revert
```bash
$RG "checkpoint|Checkpoint|snapshot|savepoint"
$RG "git.*tag|git.*stash|checkpoint.*sha"
$RG "revert|reset.*hard|git.*reset|rollback"
$RG "replan|re.plan|rebuild.*from.*checkpoint"
```

### M6.6 Delivery
```bash
$RG "pull.*request|merge.*request|create.*pr|createPR|octokit"
$RG "git.*merge|git.*push|cherry.pick"
$RG "approval.*gate|review.*gate|human.*approve"
```

---

## M7 — Memory Architecture

### M7.1–M7.2 Working memory & project memory
```bash
$RG "memory|Memory|knowledge|Knowledge"
$RG "CLAUDE\.md|AGENTS\.md|memory.*file|knowledge.*base"
$RG "sqlite.*memory|memory.*table|memory.*store"
$RG "vector.*store|embedding.*store|lancedb|sqlite.vec"
$RG "dolt|beads|version.*controlled.*sql"
```

### M7.3 Decision logging
```bash
$RG "decision.*log|decision.*record|append.*log|audit.*trail"
$RG "log.*decision|record.*choice|trace.*decision"
```

### M7.4 Learning ritual
```bash
$RG "distill|summarize.*session|post.*run.*summary|learn.*from"
$RG "update.*memory|write.*memory|memory.*update"
```

### M7.5 Retrieval
```bash
$RG "retriev|search.*memory|query.*memory|FTS|full.text"
$RG "semantic.*search|vector.*search|embed.*query"
```

### M7.6 Cross-agent sharing
```bash
$RG "shared.*memory|shared.*state|cross.*agent|inter.*agent"
$RG "lock|mutex|transaction|concurrent.*access"
$RG "crdt|CRDT|merge.*conflict"
```

---

## M8 — Security & Policy

### M8.1 Hook integration
```bash
$RG "PreToolUse|PostToolUse|hook|Hook|intercept|middleware"
$RG "before.*tool|after.*tool|tool.*filter|permission.*check"
```

### M8.2–M8.3 Policy schema & layering
```bash
$RG "policy|Policy|allow|deny|permit|block|rule"
$RG "global.*policy|repo.*policy|session.*policy|layer.*policy"
$RG -g "*.yaml" -g "*.yml" -g "*.json" "allow|deny|permission"
```

### M8.4 Sandbox
```bash
$RG "sandbox|Sandbox|restrict|allowedPath|blockedPath"
$RG "network.*restrict|firewall|egress|ingress"
$RG "docker|container.*isolat|seccomp|apparmor"
```

### M8.5 Audit log
```bash
$RG "audit|Audit|tool.*log|action.*log|structured.*log"
$RG "log.*tool.*call|record.*invocation"
```

### M8.6 Secret management
```bash
$RG "secret|Secret|vault|Vault|1password|keyring"
$RG "inject.*env|env.*inject|scoped.*env|env.*scope"
$RG "credential.*store|secret.*store"
```

---

## M9 — Planning & Decomposition

### M9.1–M9.2 Decomposition & task graph
```bash
$RG "decompos|breakdown|split.*task|parse.*prd|PRD"
$RG "task.*graph|dependency.*graph|dag|DAG|blocker"
$RG "plan|Plan|planner|Planner"
```

### M9.3 Plan format
```bash
$RG "plan.*schema|PlanSchema|plan.*format|task.*contract"
$RG -g "*.yaml" -g "*.md" "acceptance.*criteria|goal|constraint"
```

### M9.4–M9.6 Invalidation, re-planning, budget
```bash
$RG "invalidat|replan|re.plan|amend.*plan"
$RG "plan.*signal|plan.*stale|plan.*outdated"
$RG "replan.*budget|replan.*limit|max.*replan"
```

---

## M10 — Multi-Agent Coordination

### M10.1 Parallelism
```bash
$RG "parallel|concurrent|Promise\.all|Promise\.allSettled|asyncio\.gather"
$RG "worker|pool|swarm|fleet|agent.*count"
```

### M10.2 Coordination
```bash
$RG "blackboard|shared.*dir|coordination|coordinate"
$RG "message.*queue|channel|pubsub|event.*bus"
$RG "sqlite.*shared|shared.*db|coordination.*store"
```

### M10.3 Consensus
```bash
$RG "consensus|vote|majority|synthesis|merge.*result"
$RG "first.*success|race|winner"
```

### M10.4 Merge strategy
```bash
$RG "merge.*queue|merge.*strategy|conflict.*resolv"
$RG "git.*merge|auto.*merge|sequential.*merge"
```

### M10.5 Inter-agent protocol
```bash
$RG "A2A|a2a|agent.*to.*agent|agent2agent"
$RG "MCP|mcp|model.*context.*protocol" --type=ts --type=py
$RG "json.rpc|jsonrpc|rpc.*server|rpc.*client"
$RG "agent.*protocol|protocol.*handler|protocol.*adapter"
```
**Decision logic:** MCP as coordination (not just tool provision) → B. A2A / Google agent protocol → C. Custom message format → D. Note: IBM's "Agent Communication Protocol" merged into A2A — treat A2A references as C.

---

## M11 — Daemon & Scheduling

### M11.1 Process model
```bash
$RG "daemon|Daemon|service|launchd|systemd|background"
$RG "detach|daemonize|fork.*background|nohup"
```
Also: `find <repo> -name "*.plist" -o -name "*.service"` — systemd/launchd unit files.

### M11.2 Repo scope
```bash
$RG "multi.*repo|repo.*registry|global.*daemon|repo.*list"
```

### M11.3 Trigger model
```bash
$RG "cron|schedule|Schedule|interval|timer"
$RG "webhook|github.*event|linear.*event|label.*trigger"
$RG "telegram|slack|discord|chat.*trigger|dispatch"
```

### M11.4 Daemon recovery
```bash
$RG "recover.*state|restore.*state|reconstruct|snapshot.*restore"
$RG "WAL|journal|crash.*recovery|state.*machine.*persist"
```

---

## M12 — Human Interface & Gates

### M12.1 Autonomy model
```bash
$RG "gate|Gate|approval|approve|checkpoint|human.*review"
$RG "autonom|autonomous|skip.*permission|dangerously"
$RG "configurable.*gate|per.*step.*gate"
```

### M12.2–M12.3 Notification & review surface
```bash
$RG "notify|Notify|notification|alert|telegram.*send|slack.*send"
$RG "TUI|tui|terminal.*ui|blessed|ink|bubbles|bubbletea"
$RG "web.*ui|dashboard|http.*server|express|fastify"
```

### M12.4 Autonomy switching
```bash
$RG "switch.*autonom|change.*mode|escalat.*to.*human|override"
```

### M12.5 Primary interaction surface
```bash
# TUI frameworks
$RG "ink|blessed|bubbletea|bubbles|tui-rs|ratatui|cursive|textual"
$RG "TUI|tui|terminal.*ui|render.*screen|key.*binding"

# Desktop GUI frameworks
$RG "electron|Electron|tauri|Tauri|swift.*ui|SwiftUI|gtk|Qt"
find <repo> -maxdepth 2 \( -name "*.swift" -o -name "*.dmg" -o -name "electron-builder*" -o -name "tauri.conf*" \) 2>/dev/null

# Web dashboard
$RG "express|fastify|hono|next|nuxt|react.*app|vue.*app|svelte"
$RG "dashboard|Dashboard|web.*ui|WebUI|http.*server|serve.*static"

# IDE extension
$RG "vscode|VS.Code|extension\.ts|activate\(|contributes.*commands"
find <repo> -maxdepth 2 -name "extension.ts" -o -name ".vscodeignore" 2>/dev/null

# Chat as primary surface
$RG "telegram.*bot|slack.*bot|discord.*bot|bot.*command|message.*handler"
```
**Decision logic:** Check README first — it usually states "CLI tool" or "desktop app" or "TUI" upfront. Then verify with framework detection above.

### M12.6 Deployment model
```bash
# Global CLI install signals
$RG -g "package.json" "\"bin\"" 
$RG "npm.*install.*-g|brew.*install|cargo.*install|pip.*install"
find <repo> -maxdepth 1 -name "Homebrew" -o -name "Formula" -o -name "*.rb" 2>/dev/null

# Desktop app packaging
$RG "electron-builder|dmg|nsis|AppImage|tauri.*bundle"
find <repo> -maxdepth 2 -name "electron-builder.*" -o -name "tauri.conf.*" 2>/dev/null

# Self-hosted / Docker
find <repo> -maxdepth 2 -name "Dockerfile" -o -name "docker-compose*" -o -name "compose.yaml" 2>/dev/null
$RG "FROM.*node|FROM.*python|FROM.*rust" -g "Dockerfile*"

# SaaS signals
$RG "vercel|netlify|fly\.io|render\.com|heroku|cloud.*run"

# IDE plugin distribution
$RG "vsce.*publish|marketplace|extensionPack"
find <repo> -maxdepth 2 -name ".vsixmanifest" -o -name "extension.vsixmanifest" 2>/dev/null
```

### M12.7 Real-time session visibility
```bash
# Log tailing
$RG "tail.*log|follow.*log|stream.*log|log.*stream|pino.*transport"

# Live TUI rendering
$RG "render|Render|refresh|redraw|screen.*update|live.*view"
$RG "spinner|progress.*bar|status.*line|status.*panel"

# Live web dashboard (WebSocket for real-time)
$RG "WebSocket|ws://|wss://|socket\.io|Server-Sent|EventSource"
$RG "live.*update|real.*time|push.*update|stream.*status"

# tmux attach
$RG "tmux.*attach|attach.*session|tmux.*a "
```

### M12.8 Client-agent protocol
```bash
# ACP (Agent Client Protocol — the "LSP for coding agents")
$RG "acp|ACP|agent.*client.*protocol|agentclientprotocol"
$RG "acp.*server|AcpServer|acp.*handler|acp.*client"

# LSP-extended
$RG "language.*server|LSP|lsp.*extend|ai.*lsp"

# Custom JSON-RPC
$RG "json.rpc|jsonrpc|JsonRpc|json_rpc" --type=ts --type=py --type=rs

# REST API agent server
$RG "http.*server|serve.*api|agent.*endpoint|/api/agent"
```
**Decision logic:** Explicit ACP implementation or dependency → B. LSP with AI extensions → C. Custom JSON-RPC (not ACP/MCP) → D. HTTP REST server → E. None of the above → A.

---

## M13 — Observability & Telemetry

```bash
$RG "token.*count|usage|cost|billing|meter"
$RG "metric|Metric|prometheus|statsd|gauge|counter|histogram"
$RG "trace|Trace|span|Span|opentelemetry|tracing"
$RG "status|health|heartbeat.*endpoint|/health"
$RG "pino|winston|bunyan|consola|log.*level"
```

---

## M14 — Extensibility & Plugin Model

```bash
$RG "plugin|Plugin|extension|Extension|addon|middleware"
$RG "register|Registry|hook.*register|on\(.*event"
$RG "hot.*reload|dynamic.*import|lazy.*load"
$RG "mcp.*server.*url|tool.*provider|custom.*tool"
```

---

## M15 — Verification & Quality Gates

### M15.1 Verification method
```bash
$RG "verif|Verif|validat|Validat|quality.*gate|QualityGate"
$RG "self.*review|review.*own|review.*diff|review.*change"
$RG "blind.*valid|independent.*valid|separate.*review"
$RG "lint|eslint|tsc|typecheck|type.check|mypy|ruff|clippy"
$RG "test.*pass|run.*test|test.*gate|test.*suite|bun.*test|jest|pytest"
$RG "review.*agent|reviewer|Reviewer|code.*review"
```

### M15.2 Gate placement
```bash
$RG "pre.*commit|precommit|pre-commit|commit.*hook"
$RG "pre.*merge|pre.*delivery|before.*push|before.*merge"
$RG "post.*step|after.*step|step.*gate|step.*check"
$RG "pr.*check|merge.*check|ci.*check|status.*check"
```

### M15.3 Failure action
```bash
$RG "retry.*on.*fail|feedback.*append|error.*context"
$RG "revert.*and.*retry|replan.*on.*fail|abort.*on.*fail"
$RG "escalat.*on.*fail|human.*on.*fail|notify.*fail"
```

### M15.4 Verification budget
```bash
$RG "verif.*budget|review.*budget|max.*review|max.*verif"
$RG "retry.*limit|attempt.*limit|fix.*attempt|max.*fix"
```

---

## Cross-cutting patterns

These patterns reveal architecture regardless of module:

```bash
# Type/interface definitions (TypeScript) — reveal data model
$RG "^(export )?(interface|type) " --type=ts | head -40

# Zod schemas — reveal validated contracts
$RG "z\.(object|string|number|enum|union)" --type=ts | head -30

# Database schemas — reveal persistence model
$RG "CREATE TABLE|schema|migration" -g "*.sql" -g "*.ts" -g "*.py" | head -20

# State machine definitions — reveal workflow model
$RG "createMachine|Machine|state.*machine|transition|guard" | head -20

# CLI command registration — reveal the system's verbs
$RG "command\(|\.command|addCommand|register.*command" | head -20

# Config loading — reveal configuration architecture
$RG "loadConfig|readConfig|parseConfig|c12|cosmiconfig|dotenv" | head -10

# Entry points
find <repo> -maxdepth 2 \( -name "main.*" -o -name "index.*" -o -name "cli.*" -o -name "app.*" \) | head -10
```
