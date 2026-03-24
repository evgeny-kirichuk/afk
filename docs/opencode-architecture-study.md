# OpenCode Architecture Study

> Based on source analysis of [sst/opencode](https://github.com/sst/opencode) v1.3.0 (2026-03-22). 129k stars, 826 contributors, Bun + TypeScript monorepo.

## 1. Client/Server Architecture

OpenCode uses a **client/server architecture** where the server is a Bun/TypeScript process and the TUI is one of several possible clients.

### Server (`packages/opencode/src/server/`)

- **Framework**: Hono HTTP server with WebSocket support (via `hono/bun`)
- **Routes**: Modular route files — `SessionRoutes`, `ProjectRoutes`, `ProviderRoutes`, `PermissionRoutes`, `ConfigRoutes`, `FileRoutes`, `PtyRoutes`, `McpRoutes`, `EventRoutes`, `QuestionRoutes`
- **Auth**: Basic auth middleware, CORS support
- **mDNS**: Discovery via `MDNS` module for local network pairing
- **Storage**: SQLite via Drizzle ORM (`@/storage/db`) for sessions, messages, parts, permissions, projects
- **Real-time**: Server-Sent Events (SSE) via `EventRoutes` for streaming updates to clients

### Clients

- **TUI**: Terminal UI (the primary client — built by "neovim users and the creators of terminal.shop")
- **Desktop**: Electron-based desktop app (`packages/desktop-electron/`)
- **Web console**: (`packages/console/`, `packages/web/`)
- **Mobile**: The architecture explicitly enables remote driving from mobile apps
- **ACP**: Agent Client Protocol mode for programmatic access

### Communication

Clients communicate with the server over HTTP REST + WebSocket/SSE. The server owns all state (sessions, messages, permissions, config). Clients are stateless views.

## 2. Session & Subagent Model

### Sessions

- **Schema**: `SessionID` (typed ID), persisted in SQLite with fields: `projectID`, `workspaceID`, `parentID`, `title`, `slug`, `version`, `permission`, timestamps
- **Parent-child hierarchy**: Sessions can have a `parentID`, creating a tree. Child sessions are created by the Task tool for subagent work.
- **Titles**: Auto-generated (`"New session - <ISO>"`, `"Child session - <ISO>"`), with fork support (`"title (fork #N)"`)
- **Compaction**: Long sessions are compacted (summarized) to manage context window — dedicated `compaction` agent handles this
- **Snapshots**: Git-level snapshots tied to sessions for revert capability

### Subagent Model (Task Tool)

The `TaskTool` (`packages/opencode/src/tool/task.ts`) is the core mechanism for spawning subagents:

1. Parent agent calls `task` tool with `{ description, prompt, subagent_type, task_id? }`
2. Tool creates a **child session** linked to parent via `parentID`
3. Child session runs with the specified agent's permissions and model
4. Child inherits parent's model unless agent has explicit model override
5. `task_id` parameter allows **resuming** a previous subagent session (passing prior session ID continues the conversation)

**Permission inheritance**: Child sessions get additional restrictions:
- `todowrite` and `todoread` denied by default
- If agent doesn't have `task` permission, recursive subagent spawning is denied
- `config.experimental?.primary_tools` can whitelist tools for children

### Doom Loop Detection

The processor detects doom loops: if the last 3 tool calls all failed/errored, it triggers a `doom_loop` permission check, potentially breaking the agent out of repetitive failure patterns.

### Iteration Limits

- Agent definitions support `steps: z.number().int().positive().optional()` — configurable per-agent step limit
- No global iteration cap in the session processor; relies on model behavior and permission checks
- Budget control is external (API-level token limits per provider)

## 3. Agent Definition & Permission Model

### Agent Definitions

Agents are defined in `packages/opencode/src/agent/agent.ts` with schema:

```typescript
Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().optional(),
  hidden: z.boolean().optional(),
  topP: z.number().optional(),
  temperature: z.number().optional(),
  color: z.string().optional(),
  permission: Permission.Ruleset,
  model: z.object({ modelID, providerID }).optional(),
  variant: z.string().optional(),
  prompt: z.string().optional(),
  options: z.record(z.string(), z.any()),
  steps: z.number().int().positive().optional(),
})
```

**Built-in agents**:

| Agent | Mode | Purpose | Key permissions |
|-------|------|---------|-----------------|
| `build` | primary | Default full-access development agent | question: allow, plan_enter: allow |
| `plan` | primary | Read-only analysis, code exploration | edit: deny (except `.opencode/plans/`), plan_exit: allow |
| `general` | subagent | Multi-step research, parallel work | todoread/todowrite: deny |
| `explore` | subagent | Fast codebase search | Only read/search tools allowed |
| `compaction` | primary (hidden) | Session summarization | All tools denied |
| `title` | primary (hidden) | Generate session titles | All tools denied, temperature: 0.5 |
| `summary` | primary (hidden) | Generate session summaries | All tools denied |

**Custom agents**: Defined in project config (`opencode.jsonc`) or `.opencode/agent/*.md` files. Markdown frontmatter format:

```markdown
---
description: ALWAYS use this when writing docs
color: "#38A3EE"
---
You are an expert technical documentation writer...
```

Config can override agent properties: `model`, `prompt`, `description`, `temperature`, `top_p`, `mode`, `color`, `hidden`, `steps`, `options`, `permission`. Agents can be disabled with `disable: true`.

### Permission Model

**Three-action system**: `allow`, `deny`, `ask`

**Rule structure**:
```typescript
Rule = { permission: string, pattern: string, action: "allow" | "deny" | "ask" }
```

**Permission categories** (from defaults):
- `*` (wildcard) — default `allow`
- `doom_loop` — `ask` (break out of loops)
- `external_directory` — `ask` per directory, with glob patterns
- `question` — `deny` by default (agents can't ask user unless allowed)
- `plan_enter` / `plan_exit` — `deny` by default
- `read` — `allow`, except `*.env`/`*.env.*` files which are `ask`
- `edit` — tool-level (maps to `edit`, `write`, `apply_patch`, `multiedit`)
- `task` — controls which subagents can be spawned

**Resolution**: Rules evaluated with wildcard matching. Last matching rule wins. Rulesets are merged in order: defaults → user config → agent-specific.

**Config format** (`opencode.jsonc`):
```jsonc
{
  "permission": {
    "edit": {
      "packages/opencode/migration/*": "deny"
    }
  }
}
```

## 4. Provider Abstraction

OpenCode uses Vercel AI SDK (`ai` package) as the universal provider interface.

**Bundled providers** (direct imports in `provider.ts`):
- Anthropic (`@ai-sdk/anthropic`)
- OpenAI (`@ai-sdk/openai`)
- Google Generative AI (`@ai-sdk/google`)
- Google Vertex AI (`@ai-sdk/google-vertex`) + Vertex Anthropic
- Amazon Bedrock (`@ai-sdk/amazon-bedrock`)
- Azure (`@ai-sdk/azure`)
- OpenRouter (`@openrouter/ai-sdk-provider`)
- GitHub Copilot (custom OpenAI-compatible)
- XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, GitLab
- OpenAI-compatible for custom endpoints
- Gateway (`@ai-sdk/gateway`)

**Config**:
```jsonc
{
  "provider": {
    "opencode": { "options": {} },
    "anthropic": { "api_key": "..." },
    "custom": { "api": "https://...", "models": [...] }
  }
}
```

**Model resolution**: `Provider.parseModel("anthropic/claude-sonnet-4-6")` splits into `providerID` + `modelID`. Fuzzy search for model names via `fuzzysort`.

**SSE timeout handling**: Custom wrapper for SSE streams with configurable read timeouts per provider.

## 5. Lessons for AFK

### Adopt

1. **Agent-as-config pattern**: OpenCode's agent definitions (name, mode, permission, prompt, model, steps) map well to AFK's step-agent binding. Consider markdown frontmatter format for custom agents.
2. **Permission ruleset with glob patterns**: The three-action (allow/deny/ask) model with wildcard matching is elegant and composable. AFK should adopt this for autonomy modes.
3. **Parent-child session hierarchy**: The Task tool's `parentID` linking and optional session resume (`task_id`) is exactly what AFK needs for track-level and step-level session management.
4. **Doom loop detection**: Tracking consecutive tool failures and breaking out is a practical safety mechanism AFK should implement.

### Adapt

1. **Client/server separation**: OpenCode's Hono server is overkill for AFK Phase 1 but the right direction for Phase 3+. AFK can start with direct process spawning but plan the HTTP API boundary.
2. **Provider abstraction via Vercel AI SDK**: OpenCode goes deep on provider integration because it runs inference directly. AFK delegates to CLI tools, so provider abstraction is at the CLI invocation layer, not the SDK layer.
3. **Step limits**: OpenCode's per-agent `steps` field is optional. AFK needs mandatory iteration limits (`max_task_iterations`, `max_step_retries`) since agents run unattended.
4. **Compaction/summarization**: OpenCode's dedicated compaction agent for long sessions is relevant for AFK's multi-step workflows. Consider similar approach for cross-step context transfer.

### Avoid

1. **Tight coupling to Vercel AI SDK**: OpenCode is deeply tied to `ai` package types (`ModelMessage`, `StreamTextResult`, `ToolSet`). AFK should stay CLI-first and not depend on any SDK internals.
2. **SQLite for session state**: Adds operational complexity. AFK's file-based approach (YAML/JSON in `.afk/`) is simpler and more git-friendly for Phase 1-2.
3. **Effect-TS dependency**: OpenCode uses Effect for service injection and error handling. While powerful, it's a heavy dependency. AFK should use simpler patterns (plain async/await, Zod for validation).
4. **Hidden complexity in permission merging**: OpenCode's multi-layer permission merge (defaults → global → project → .opencode → agent-specific) creates hard-to-debug behavior. AFK should keep permission resolution simpler — project config → autonomy mode → step override.
