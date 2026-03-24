# CLI Provider Spike — AFK Phase 1

> Probed 2026-03-24. Versions: Claude Code 2.1.72, Codex CLI 0.116.0, Gemini CLI 0.34.0, Copilot CLI 1.0.11. OpenCode is docs-based only (not installed).

## Per-Provider Findings

### 1. Claude Code

| Aspect | Details |
|--------|---------|
| **A. Non-interactive invocation** | `claude -p "prompt"` — prints response and exits |
| **B. System prompt injection** | `--append-system-prompt "text"` appends to default system prompt; `--system-prompt "text"` replaces entirely |
| **C. Output format** | `--output-format json` (single result), `stream-json` (realtime JSONL), `text` (default) |
| **D. Working directory** | Inherits cwd from parent process |
| **E. Model selection** | `--model <alias-or-id>` e.g. `--model sonnet`, `--model claude-opus-4-6` |
| **F. Turn/iteration limits** | `--max-budget-usd <amount>` (only with `--print`). No explicit turn limit flag. |
| **G. Auto-approve mode** | `--permission-mode bypassPermissions` or `--dangerously-skip-permissions`. Safer: `--permission-mode acceptEdits` |
| **H. Exit codes** | Standard 0/1. No documented quota-specific codes. |
| **I. Session continuity** | `--session-id <uuid>`, `-r/--resume [id]`, `-c/--continue` (most recent), `--fork-session` |
| **J. Additional dirs** | `--add-dir <dir>` (repeatable) |

**Notable extras**: `--allowedTools` / `--disallowedTools` for tool filtering, `--json-schema` for structured output, `--effort` level, `--worktree` for git worktree isolation, `--agent` / `--agents` for custom agent definitions, `--fallback-model` for overload resilience.

### 2. Codex CLI

| Aspect | Details |
|--------|---------|
| **A. Non-interactive invocation** | `codex exec "prompt"` — runs non-interactively. Prompt from stdin if `-` or omitted. |
| **B. System prompt injection** | No dedicated system prompt flag. Prompt is the instruction. Config overrides via `-c key=value`. |
| **C. Output format** | `--json` emits JSONL events to stdout. `-o/--output-last-message <file>` writes final message to file. `--output-schema <file>` for structured output. |
| **D. Working directory** | `-C/--cd <dir>` sets agent working root |
| **E. Model selection** | `-m/--model <model>` e.g. `-m o3` |
| **F. Turn/iteration limits** | No explicit turn/budget limit flag. Relies on model behavior. |
| **G. Auto-approve mode** | `--full-auto` (sandboxed auto-execution), `-a never` (never ask), `--dangerously-bypass-approvals-and-sandbox` |
| **H. Exit codes** | Standard. No documented special codes. |
| **I. Session continuity** | `codex resume` subcommand, `codex exec resume` for non-interactive resume, `codex fork` to branch from prior session |
| **J. Additional dirs** | `--add-dir <dir>` (repeatable) |

**Notable extras**: `--sandbox <mode>` (read-only/workspace-write/danger-full-access), `--oss` for local LLM providers (LM Studio, Ollama), `--ephemeral` for no session persistence, `codex review` for code review, `codex mcp-server` to run as MCP server.

### 3. Gemini CLI

| Aspect | Details |
|--------|---------|
| **A. Non-interactive invocation** | `gemini -p "prompt"` — non-interactive headless mode |
| **B. System prompt injection** | No dedicated system prompt flag. Prompt is the instruction. Policy files via `--policy`. |
| **C. Output format** | `-o/--output-format` with choices: `text`, `json`, `stream-json` |
| **D. Working directory** | Inherits cwd. No explicit `--cd` flag. |
| **E. Model selection** | `-m/--model <model>` |
| **F. Turn/iteration limits** | No explicit turn/budget limit flags. |
| **G. Auto-approve mode** | `-y/--yolo` auto-accepts all actions. `--approval-mode yolo\|auto_edit\|plan\|default` for finer control. |
| **H. Exit codes** | Standard. No documented special codes. |
| **I. Session continuity** | `-r/--resume` with `latest` or session index. `--list-sessions` to enumerate. |
| **J. Additional dirs** | `--include-directories <dirs>` (comma-separated or repeatable) |

**Notable extras**: `--sandbox` flag, `--policy` for custom policy files, extensions system (`-e/--extensions`, `--list-extensions`), skills system, hooks system, `--acp` for Agent Client Protocol mode.

### 4. GitHub Copilot CLI

| Aspect | Details |
|--------|---------|
| **A. Non-interactive invocation** | `copilot -p "prompt" --allow-all-tools` — non-interactive, exits after completion |
| **B. System prompt injection** | No dedicated system prompt flag. `--agent <agent>` for custom agents. Instructions loaded from `AGENTS.md` (disable with `--no-custom-instructions`). |
| **C. Output format** | `--output-format json` (JSONL) or `text` (default). `-s/--silent` for response-only output. |
| **D. Working directory** | Inherits cwd. No explicit `--cd` flag. |
| **E. Model selection** | `--model <model>` e.g. `--model gpt-5.2` |
| **F. Turn/iteration limits** | `--max-autopilot-continues <count>` limits continuation in autopilot mode. `--effort/--reasoning-effort` for reasoning control. |
| **G. Auto-approve mode** | `--allow-all` (all permissions), `--yolo` (alias), `--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`. `--autopilot` for continuation. `--no-ask-user` disables user questions. |
| **H. Exit codes** | Standard. No documented special codes. |
| **I. Session continuity** | `--continue` (most recent), `--resume[=sessionId]` (picker or specific ID) |
| **J. Additional dirs** | `--add-dir <dir>` (repeatable) |

**Notable extras**: `--allow-tool` / `--deny-tool` with glob patterns (e.g. `shell(git:*)`), `--allow-url` / `--deny-url` for network access control, `--plugin-dir` for plugins, `--share` / `--share-gist` for session export, `--acp` for Agent Client Protocol, built-in GitHub MCP server with tool/toolset selection.

### 5. OpenCode (docs-based — not installed)

| Aspect | Details |
|--------|---------|
| **A. Non-interactive invocation** | Not a traditional CLI. Client/server architecture — Go TUI client connects to Bun HTTP server. |
| **B. System prompt injection** | Agent definitions in config with system prompts per agent. |
| **C. Output format** | Structured session data via HTTP API. |
| **D. Working directory** | Server runs in project root. |
| **E. Model selection** | Provider/model config in `opencode.json`. Multiple providers supported (Anthropic, OpenAI, Google, etc.) |
| **F. Turn/iteration limits** | Subagent (Task tool) has configurable `max_iterations`. |
| **G. Auto-approve mode** | Permission model with mode types and glob-based file permissions. |
| **H. Exit codes** | N/A (server process). |
| **I. Session continuity** | Sessions persist server-side, selectable from TUI. |
| **J. Additional dirs** | Configured per-project. |

---

## Cross-Provider Comparison

| Capability | Claude | Codex | Gemini | Copilot | OpenCode |
|-----------|--------|-------|--------|---------|----------|
| Non-interactive flag | `-p` | `exec` | `-p` | `-p` | N/A (server) |
| System prompt | `--append-system-prompt` | ✗ (config only) | ✗ (policy files) | ✗ (AGENTS.md) | Config agents |
| JSON output | `--output-format json` | `--json` | `-o json` | `--output-format json` | HTTP API |
| Model selection | `--model` | `-m` | `-m` | `--model` | Config |
| Budget/turn limit | `--max-budget-usd` | ✗ | ✗ | `--max-autopilot-continues` | `max_iterations` |
| Full auto-approve | `--dangerously-skip-permissions` | `--full-auto` | `-y/--yolo` | `--yolo/--allow-all` | Permission modes |
| Session resume | `--resume/--continue` | `resume` subcmd | `--resume` | `--resume/--continue` | Server sessions |
| Additional dirs | `--add-dir` | `--add-dir` | `--include-directories` | `--add-dir` | Config |
| Structured output | `--json-schema` | `--output-schema` | ✗ | ✗ | ✗ |
| Tool filtering | `--allowedTools` | ✗ | `--allowed-tools` (deprecated) | `--allow-tool/--deny-tool` | Glob permissions |

## Impact on AFK Executor Design

### Universal patterns (safe to rely on)
1. **Non-interactive mode**: All CLIs support single-prompt non-interactive execution (`-p` or `exec`)
2. **JSON output**: All support JSON/JSONL output for machine parsing
3. **Model selection**: All support model override via flag
4. **Session resume**: All support resuming previous sessions

### Provider-specific concerns
1. **System prompt injection**: Only Claude has a dedicated `--append-system-prompt`. Others require workarounds (prepend to prompt, config files, AGENTS.md). The executor should embed AFK step instructions into the user prompt as the universal approach, with `--append-system-prompt` as an optimization for Claude.
2. **Budget/turn limits**: Only Claude (`--max-budget-usd`) and Copilot (`--max-autopilot-continues`) have budget controls. AFK must implement its own iteration/token tracking as a safety net.
3. **Auto-approve**: Flag names differ but all support full autonomy. The executor needs a per-provider flag map.
4. **Working directory**: Claude and Gemini inherit cwd; Codex has `-C/--cd`. Executor should `chdir` before spawning.
5. **Additional dirs**: Flag name varies (`--add-dir` vs `--include-directories`). Need per-provider mapping.

### Recommended executor interface
```typescript
interface ProviderInvocation {
  binary: string;                    // "claude" | "codex" | "gemini" | "copilot"
  args: string[];                    // Built per-provider
  cwd: string;                       // Working directory
  env?: Record<string, string>;      // Environment overrides
  parseOutput: (raw: string) => StepOutput;  // Provider-specific parser
}
```

### Open questions
1. **Structured output**: Claude and Codex support JSON schema validation. Should AFK use this to enforce `StepOutput` shape, or parse free-form output?
2. **Session reuse**: Should AFK resume provider sessions across steps, or start fresh each time? Resuming saves context tokens but couples to provider session format.
3. **Sandbox modes**: Codex has granular sandbox policies. Should AFK expose these, or always run in full-auto for simplicity?
