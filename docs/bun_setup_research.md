# Building AFK: a Bun CLI for AI agent orchestration in 2026

**Bun has become the runtime of choice for AI-adjacent CLI tooling.** Since Anthropic's acquisition of Bun in December 2025, Claude Code itself ships as a Bun-compiled binary, and tools like Composio's Agent Orchestrator and Overstory prove the architecture you're targeting—spawning parallel agent CLIs across git worktrees—is not only viable but increasingly standardized. This report distills the current consensus across all seven areas of your stack, with concrete patterns, library picks, and anti-patterns drawn from production Bun CLI tools as of March 2026.

The ecosystem has matured rapidly. Bun v1.3.10 offers native YAML/JSONL/JSONC parsing, built-in PTY support for subprocess management, and a `bun build --compile` pipeline that produces **~55–60 MB** self-contained macOS binaries. The UnJS ecosystem (c12, consola, citty) provides the configuration and logging primitives. And the AI agent orchestration space has converged on a clear pattern: a deterministic Bun supervisor dispatching bounded tasks to non-deterministic agent subprocesses, each isolated in its own git worktree.

---

## 1. Project structure, argument parsing, and build pipeline

### Standard layout

Bun runs TypeScript directly—no build step during development. The canonical structure for a CLI like AFK:

```
afk/
├── src/
│   ├── cli.ts              # Entry point (shebang + arg parsing)
│   ├── commands/            # Subcommand handlers
│   │   ├── spawn.ts
│   │   ├── status.ts
│   │   └── kill.ts
│   ├── lib/                 # Core logic
│   │   ├── supervisor.ts
│   │   ├── worktree.ts
│   │   └── ipc.ts
│   └── types.ts
├── tests/
│   └── *.test.ts
├── package.json
├── tsconfig.json
├── bunfig.toml
└── bun.lock                 # Text-based lockfile (Bun v1.2+)
```

Use `@tsconfig/bun` as your base TypeScript config—it sets `module: "Preserve"`, `moduleResolution: "bundler"`, `strict: true`, and `noEmit: true` (Bun handles transpilation, so `tsc` is only for type checking):

```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*.ts"]
}
```

For `bunfig.toml`, the relevant settings for a long-running CLI are minimal:

```toml
[install]
exact = true

[test]
timeout = 15000
coverage = true
```

The `smol = true` flag trades throughput for lower memory by running GC more aggressively—worth benchmarking for your overnight use case.

### Argument parsing

**For a CLI with subcommands** like AFK, the consensus splits into two tiers:

- **Zero-dependency option**: `util.parseArgs` from `node:util` is fully supported in Bun and officially recommended for simple CLIs. It handles flags and positionals but provides no help generation or subcommand routing.

- **For subcommands with help text**: **Commander** (500M+ weekly npm downloads, battle-tested, lightweight) is the safe default. **Citty** from the UnJS ecosystem is the modern alternative—type-safe, 24 KB, supports lazy-loaded subcommands and plugins. Both work flawlessly with Bun.

```typescript
#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

const spawn = defineCommand({
  meta: { name: "spawn", description: "Spawn an agent session" },
  args: {
    agent: { type: "positional", description: "Agent binary (claude, codex, gemini)" },
    task: { type: "string", description: "Task file path", required: true },
    worktree: { type: "string", description: "Worktree name" },
  },
  run({ args }) { /* ... */ },
});

const main = defineCommand({
  meta: { name: "afk", version: "1.0.0" },
  subCommands: { spawn, status: () => import("./commands/status").then(m => m.default) },
});

runMain(main);
```

**Avoid** `minimist` (unmaintained, no types), full `yargs` when you only need parsing (use `yargs-parser` instead), and any library that doesn't handle `process.argv.slice(2)` correctly.

### Building and distribution

**`bun build --compile`** is the production path. The recommended flags:

```bash
bun build ./src/cli.ts --compile --outfile afk \
  --production --bytecode --minify
```

This produces a **~55–60 MB** self-contained binary for macOS (no runtime dependency). Cross-compilation is built in—`--target=bun-darwin-arm64`, `--target=bun-linux-x64`, etc. Startup time is roughly **80–87 ms**, within 17% of equivalent Go binaries.

Key tradeoffs and the recommended dual-distribution strategy:

| Approach | Binary size | Requires runtime | Startup | Best for |
|---|---|---|---|---|
| `bun build --compile` | ~55–60 MB | No | ~80 ms | Homebrew tap, GitHub Releases |
| npm with `#!/usr/bin/env bun` shebang | ~KB | Bun installed | ~50 ms | Developer audience |

For a tool like AFK targeting macOS developers, ship **both**: a Homebrew tap pointing to compiled binaries on GitHub Releases, plus `bun add -g @yourorg/afk` for those who already have Bun. The Tigris CLI and Claude Code both use this dual approach.

**Critical gotcha**: Dynamic `import()` expressions don't resolve the same way in compiled binaries. If you lazy-load subcommands, maintain separate entry points—one for npm distribution (dynamic imports) and one for compile (static imports with a generated registry). The Tigris CLI documents this pattern in detail.

For versioning, **Changesets** (`@changesets/cli`) is the ecosystem standard. It works with `bun publish` and integrates with GitHub Actions via `changesets/action`.

---

## 2. Bun-native APIs that matter for AFK

### Subprocess management with Bun.spawn

This is the most critical API for AFK. `Bun.spawn` returns a `Subprocess` with Promise-based exit handling, and spawns processes **60% faster** than Node's `child_process` (888µs vs 1.47ms).

```typescript
const proc = Bun.spawn(["claude", "--task", taskFile], {
  cwd: worktreePath,
  env: { ...process.env, CLAUDE_MODEL: "sonnet" },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  timeout: 3_600_000,              // 1 hour hard timeout
  signal: abortController.signal,  // For graceful cancellation
  onExit(proc, exitCode, signalCode) {
    children.delete(proc.pid);
  },
});
```

For streaming stdout from long-running agents:

```typescript
for await (const chunk of proc.stdout) {
  const text = new TextDecoder().decode(chunk);
  appendToTranscript(sessionId, text);
}
```

**Six gotchas for long-running subprocess management:**

1. **Env snapshot timing**: `Bun.spawn` captures `process.env` at Bun startup, not at call time. Always pass `env` explicitly if you modify environment variables at runtime.
2. **`onExit` race**: The `onExit` callback may fire *before* `Bun.spawn` returns. Use `await proc.exited` for reliable exit handling.
3. **Set `lazy: true`** when you don't need stdout immediately—it defers pipe reading and saves resources.
4. **Set `maxBuffer`** to prevent a runaway agent from consuming unlimited memory via stdout.
5. **Use `proc.unref()`** on subprocesses that shouldn't prevent the supervisor from exiting.
6. **PTY mode** (v1.3.5+): For agents that expect a terminal, use the `terminal` option instead of raw pipes—this avoids output buffering issues.

### Native file formats replace npm dependencies

Bun v1.3.x has eliminated the need for several common dependencies:

```typescript
// YAML — native C implementation, no npm package needed
const config = Bun.YAML.parse(await Bun.file("afk.yaml").text());

// JSONL — native, with streaming support for transcripts
const entries = Bun.JSONL.parse(await Bun.file("session.jsonl").text());

// Streaming JSONL parsing (crucial for large transcripts)
for await (const chunk of Bun.file("transcript.jsonl").stream()) {
  const { values, read } = Bun.JSONL.parseChunk(chunk);
  for (const event of values) processEvent(event);
}

// JSONC — for config files with comments
const tsconfig = Bun.JSONC.parse(await Bun.file("tsconfig.json").text());

// JSON — optimized internally
const state = await Bun.file("state.json").json();
```

**`Bun.write` is not atomic.** For state files that agents and the supervisor read concurrently, always write to a temp file then rename:

```typescript
async function atomicWriteJSON(path: string, data: unknown) {
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);  // from node:fs/promises — atomic on POSIX
}
```

### Other APIs worth knowing

- **`Bun.which("claude")`** — verify agent binaries exist before spawning
- **`Bun.Glob`** — `new Bun.Glob("**/*.ts").scan({ cwd: "./src" })` for file discovery
- **`Bun.sleep(ms)`** — Promise-based, cleaner than `setTimeout` for polling loops
- **`Bun.nanoseconds()`** — high-resolution timing for profiling agent execution
- **`Bun.gc(true)`** — force garbage collection (always available, no `--expose-gc` needed)
- **`Bun.stringWidth()`** and **`Bun.wrapAnsi()`** — terminal text utilities, 33–88× faster than npm equivalents

### Graceful shutdown with child process cleanup

This is non-negotiable for a tool managing overnight agent sessions:

```typescript
const children = new Map<number, Bun.Subprocess>();
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn(`Received ${signal}, shutting down ${children.size} agents...`);

  for (const [, proc] of children) proc.kill("SIGTERM");

  const forceKillTimer = setTimeout(() => {
    for (const [, proc] of children) proc.kill("SIGKILL");
  }, 10_000);

  await Promise.allSettled([...children.values()].map(p => p.exited));
  clearTimeout(forceKillTimer);

  // Flush logs, persist state, cleanup worktrees
  await flushState();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
```

**Key detail**: `process.on("exit")` only allows synchronous code—all async cleanup must happen in the signal handler before calling `process.exit()`.

### Memory management for overnight runs

Bun uses **JavaScriptCore** (not V8), which optimizes for lower memory and fast startup rather than long-running throughput. The main concern is **RSS retention**: JSC's allocator (mimalloc v3) may not release memory pages back to the OS even after GC reclaims heap objects.

For a process running overnight:

```typescript
// Periodic memory monitoring
setInterval(() => {
  const { rss, heapUsed } = process.memoryUsage();
  logger.debug({ rss: `${(rss / 1024 / 1024).toFixed(1)}MB`, heap: `${(heapUsed / 1024 / 1024).toFixed(1)}MB` }, "memory");
}, 60_000);

// Periodic forced GC for long-running processes
setInterval(() => Bun.gc(true), 300_000);
```

Profile with `bun --heap-prof-md` for automated markdown reports, or `import { heapStats } from "bun:jsc"` for runtime object counts. Watch for unresolved Promises piling up, closures capturing large scopes, and `setInterval` timers that are never cleared. The `--smol` flag is worth testing for your use case—it runs GC more frequently at a modest performance cost.

Node.js compatibility is now excellent: **`node:fs/promises`, `node:path`, and `node:os` all pass 92–100% of Node's own test suites.** The main gaps are in `node:child_process` (missing `proc.gid`/`proc.uid`, IPC socket handle passing) and `node:vm` (partial). For AFK's purposes, prefer `Bun.spawn` over `node:child_process` anyway.

---

## 3. Terminal output, logging, and dual-mode UX

### The recommended library stack

| Purpose | Library | Rationale |
|---|---|---|
| Colors | **picocolors** | 7 KB, zero deps, fastest load (0.46ms vs chalk's 6.1ms), respects `NO_COLOR` |
| CLI logging | **consola** | Pretty output in TTY, basic output in CI, custom reporters for JSON |
| Structured logging | **pino** + **pino-roll** | Fastest JSON logger, built-in rotation transport |
| Prompts | **@clack/prompts** | Beautiful UX (verify Bun compat per version; fall back to @inquirer/prompts) |
| Spinners | **ora** or clack's built-in | Battle-tested, TTY-aware |

### Dual-mode output for interactive vs. overnight runs

AFK must detect its execution context and adapt output accordingly:

```typescript
import { createConsola } from "consola";

function detectMode(): "interactive" | "structured" {
  if (process.env.AFK_LOG_FORMAT === "json") return "structured";
  if (process.env.CI || !process.stdout.isTTY) return "structured";
  return "interactive";
}

const logger = createConsola({
  level: Number(process.env.LOG_LEVEL) || 3,
  reporters: detectMode() === "interactive"
    ? undefined  // FancyReporter with colors and spinners
    : [{
        log: (logObj) => process.stdout.write(JSON.stringify({
          ts: logObj.date.toISOString(),
          level: logObj.type,
          msg: logObj.args.join(" "),
          ...(logObj.tag && { tag: logObj.tag }),
        }) + "\n"),
      }],
});
```

For the overnight unattended case, use **pino** with `pino-roll` for automatic log rotation:

```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-roll",
    options: {
      file: `${process.env.HOME}/.afk/logs/afk.log`,
      frequency: "daily",
      size: "10MB",
      count: 7,
      mkdir: true,
    },
  },
});
```

**Anti-patterns**: Don't use `console.log` in production (no levels, no structure). Don't run spinners when output is piped. Don't pretty-print in unattended mode—it wastes CPU and can't be parsed by log aggregators.

---

## 4. Configuration loading and schema validation

### Layered configuration with c12

**c12** (UnJS) is the modern standard for configuration loading—used by Nuxt and the entire UnJS ecosystem. It searches for config files in multiple formats, merges layers with precedence, supports environment-specific overrides, and loads `.env` files. The precedence order for AFK:

1. Built-in defaults (hardcoded)
2. Global config (`~/.config/afk/config.yaml`)
3. Project config (`afk.config.ts`, `.afkrc`, or `package.json#afk`)
4. Environment variables (`AFK_LOG_LEVEL`, `.env` files)
5. CLI flags (`--log-level=debug`)

```typescript
import { loadConfig } from "c12";

const { config: raw } = await loadConfig({
  name: "afk",
  defaults: {
    logLevel: "info",
    agents: { claude: { model: "sonnet", timeout: 3600 } },
    worktreeDir: ".trees",
    maxConcurrent: 5,
  },
  dotenv: true,
  globalRc: true,
  packageJson: true,
});
```

c12 natively supports `.ts`, `.yaml`, `.toml`, `.json`, `.jsonc` config files—no extra parsers needed.

### Validate everything with Zod v4

Zod v4 (released May 2025) is **14× faster** on string parsing and **57% smaller** than v3. It's the TypeScript-first validation standard:

```typescript
import { z } from "zod";

const AgentSchema = z.object({
  model: z.string().default("sonnet"),
  timeout: z.number().positive().default(3600),
  maxTokens: z.number().int().optional(),
  retries: z.number().int().min(0).max(5).default(2),
});

const ConfigSchema = z.object({
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  agents: z.record(z.string(), AgentSchema).default({}),
  worktreeDir: z.string().default(".trees"),
  maxConcurrent: z.number().int().min(1).max(20).default(5),
  watchdogInterval: z.number().positive().default(30_000),
});

type Config = z.infer<typeof ConfigSchema>;

const result = ConfigSchema.safeParse(raw);
if (!result.success) {
  console.error("Invalid config:", z.prettifyError(result.error));
  process.exit(1);
}
const config: Config = result.data;
```

**Avoid** Zod v3 (v4 is faster and smaller), raw `JSON.parse` without validation, and validating config in hot loops (validate once at startup).

### File watching

Use `node:fs.watch()` directly—Bun implements it natively with recursive support. Always debounce:

```typescript
import { watch } from "node:fs";

const debounced = debounce((event: string, filename: string) => {
  logger.info(`Config changed: ${filename}, reloading...`);
  reloadConfig();
}, 100);

watch("./afk.config.ts", debounced);
```

Skip chokidar unless you need glob patterns or `ready` event semantics.

---

## 5. Testing strategy for a subprocess-orchestrating CLI

### Bun's built-in test runner handles the core cases

`bun:test` is Jest-compatible, runs **3–10× faster** than Vitest, and requires zero configuration. It supports `describe`/`it`/`expect`, mocking via `mock()` and `mock.module()`, snapshot testing, code coverage, retry for flaky tests, and watch mode with HMR.

```toml
# bunfig.toml
[test]
preload = ["./tests/setup.ts"]
timeout = 15000
retry = 2
coverage = true
coverageReporter = ["text", "lcov"]
```

**Key limitation**: Bun tests run in a single process without isolation. Module mocks persist across suites. Clean up carefully in `afterEach`.

### CLI E2E testing with Bun Shell

The Bun Shell API (`$`) is the standout tool for testing CLI tools—it's a cross-platform shell built into Bun:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm } from "fs/promises";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "afk-test-"));
  await $`git init --initial-branch=main`.cwd(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true });
});

test("afk spawn creates worktree and starts agent", async () => {
  const result = await $`./afk spawn claude --task task.md`.cwd(tempDir).nothrow();
  expect(result.exitCode).toBe(0);
  
  // Verify worktree was created
  const worktrees = await $`git worktree list`.cwd(tempDir).text();
  expect(worktrees).toContain(".trees/");
});

test("afk status reports running agents", async () => {
  const output = await $`./afk status --json`.cwd(tempDir).text();
  const status = JSON.parse(output);
  expect(status.agents).toBeArray();
});
```

For testing subprocess interactions, mock external binaries by creating stub scripts and prepending them to `PATH`:

```typescript
beforeEach(async () => {
  const fakeBin = join(tempDir, "bin");
  await Bun.write(join(fakeBin, "claude"), '#!/bin/sh\necho \'{"status":"done"}\'');
  await $`chmod +x ${join(fakeBin, "claude")}`;
  process.env.PATH = `${fakeBin}:${process.env.PATH}`;
});
```

For file-based IPC testing, poll for expected state files with bounded retries rather than hardcoded `sleep` calls.

### Linting: Biome is the standard

**Biome 2.x** is the consensus choice for new Bun projects—a single tool for linting and formatting that's **10–25× faster** than ESLint + Prettier:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "semicolons": "always", "quoteStyle": "double" } }
}
```

**Oxlint** (695+ rules, 50–100× faster than ESLint) is the alternative if you need broader rule coverage or ESLint plugin compatibility. Its JS plugin system reached alpha in March 2026.

Always run `tsc --noEmit` as a separate CI step—Bun strips types for execution but never validates them.

---

## 6. AI agent orchestration: what works in production

### The architectural consensus

Two open-source projects have already built what AFK targets. Studying them reveals a clear architectural pattern:

**Composio Agent Orchestrator** (2.7k stars, TypeScript, 40K+ lines) is the most mature. It spawns parallel AI agents across git worktrees, supports Claude Code/Codex/Aider, uses tmux or Docker as runtime, and introduces a **reactions system** where CI failures or PR review comments automatically trigger agent responses. Its 8-plugin architecture (tracker, agent, runtime, workspace, SCM, notifier, planner, evaluator) is a useful decomposition template.

**Overstory** (412 stars) is notably **built with Bun**. It implements a hierarchical agent swarm: Orchestrator → Coordinator → Supervisor → Workers (Scout, Builder, Reviewer, Merger, Monitor). Its SQLite-backed messaging system and 3-tier watchdog are the most sophisticated patterns in the space.

The architectural principle from McKinsey/QuantumBlack crystallizes the lesson: **"Agents shouldn't decide what comes next. Use a deterministic workflow engine that follows predefined rules to move work through stages."** When they experimented with letting agents self-orchestrate, agents "routinely skipped steps, created circular dependencies, or got stuck in analysis loops."

### The deterministic supervisor pattern

AFK's architecture should follow the Planner-Executor separation:

```
┌─────────────────────────────────┐
│     AFK Supervisor (Bun)        │  Deterministic: owns workflow state,
│  ┌───────────┐  ┌────────────┐  │  task dispatch, health monitoring,
│  │ Scheduler  │  │ Watchdog   │  │  merge queue
│  └───────────┘  └────────────┘  │
│  ┌───────────┐  ┌────────────┐  │
│  │  Merger    │  │  Reporter  │  │
│  └───────────┘  └────────────┘  │
└──────┬──────┬──────┬────────────┘
       │      │      │
    ┌──┴──┐┌──┴──┐┌──┴──┐
    │Claude││Codex││Gemini│  Non-deterministic: bounded task execution
    │WT: A ││WT: B││WT: C│  in isolated git worktrees
    └─────┘└─────┘└─────┘
```

Each agent runs in its own **git worktree** (the universal isolation primitive) inside its own **tmux session** (the universal headless runtime). The supervisor communicates via structured files and subprocess stdin/stdout.

### Managing concurrent agents

Practical ceilings from production reports: **5–7 concurrent agents** on a laptop before rate limits, merge conflicts, and review overhead eat gains. Up to 20–50 with dedicated infrastructure and mixed providers (Claude + Codex + Gemini simultaneously to distribute rate limit pressure).

**Token budget tracking** works by parsing agent transcript files. Claude Code writes JSONL transcripts to `~/.claude/projects/<project>/sessions/<id>.jsonl`—Overstory extracts token usage, model info, and cost estimates from these files. For Codex and Gemini, similar transcript files exist in their respective config directories.

### Failure modes demand a tiered watchdog

A NeurIPS 2025 analysis of 1,642 multi-agent execution traces found **41–87% failure rates** across seven state-of-the-art systems. The critical failure modes for AFK:

- **Agent hangs/stalls**: No output for extended periods, deadlocked on user input
- **Token/context exhaustion**: Long sessions degrade output quality as context fills
- **Rate limiting**: Multiple agents overwhelming a single API provider
- **CI failure loops**: Agent's fix causes a new failure, enters infinite repair cycle
- **Silent failures**: Agent reports success but output is wrong

Overstory's **3-tier watchdog** is the most robust pattern observed:

- **Tier 0 (Mechanical)**: tmux session and PID liveness checks every 30 seconds. Pure process-level—is the session alive? Is the agent producing output?
- **Tier 1 (AI-Assisted)**: When Tier 0 detects a problem, use AI to analyze the transcript and determine recovery action (restart, compact context, escalate).
- **Tier 2 (Monitor Agent)**: A dedicated agent running continuously, patrolling the fleet for subtle issues that mechanical checks miss.

For AFK, start with Tier 0 and add tiers as needed. The key principle: **separate monitoring from execution**—the thing that runs tasks should never also judge if they're healthy.

### File-based IPC: the recommended hybrid protocol

The space has converged on a **hybrid approach** using multiple IPC mechanisms for different purposes:

| Channel | Mechanism | Purpose |
|---|---|---|
| Agent control | stdin/stdout JSONL | Send commands to agents, receive streaming events |
| Session transcripts | Append-only JSONL files | Audit log, token tracking, crash recovery |
| Inter-agent coordination | SQLite WAL mode | Message queue, merge queue (ACID, ~1–5ms/query) |
| Task status | JSON files in `.afk/status/` | Simple per-task state, watchable via `fs.watch` |

For the status files, use a state machine: `queued` → `spawning` → `running` → `completed` | `failed` | `stalled`. The supervisor watches these files; agents write to their own transcript JSONL.

```typescript
// Per-task status file: .afk/status/task-auth.json
interface TaskStatus {
  id: string;
  agent: "claude" | "codex" | "gemini";
  status: "queued" | "spawning" | "running" | "completed" | "failed" | "stalled";
  worktree: string;
  pid: number | null;
  startedAt: string | null;
  tokenUsage: { input: number; output: number } | null;
  lastActivity: string;
  error: string | null;
}
```

### Git worktree best practices

Keep all worktrees under a `.trees/` directory (add to `.gitignore`). Auto-copy `.env` files to each worktree. Run `bun install` via post-create hooks. Merge sequentially via a **FIFO queue** rather than simultaneously—this eliminates most merge conflicts. Decompose tasks along architectural boundaries so agents touch non-overlapping files. If a merge fails, the simplest recovery is to discard the branch and re-dispatch the task.

---

## 7. Distribution and developer experience

For macOS-targeting tools, the recommended distribution ladder:

1. **npm** (`bun add -g @yourorg/afk`) for developers who already have Bun. Point `"bin"` directly to your `.ts` entry file with `#!/usr/bin/env bun` shebang.
2. **Compiled binary via GitHub Releases + Homebrew tap** for everyone else. Build in CI with `bun build --compile --target=bun-darwin-arm64 --production --bytecode`.
3. **Curl installer** (`curl -fsSL https://afk.dev/install.sh | sh`) for one-line onboarding.

Use **Changesets** for versioning: developers run `bunx changeset` to describe changes per PR, CI runs `changeset version` to bump versions and update `CHANGELOG.md`, then `bun publish` or a GitHub Release workflow pushes artifacts.

---

## Conclusion: the crystallized stack

The Bun CLI ecosystem has reached production maturity for exactly the kind of tool AFK aims to be. The key insight from studying existing agent orchestrators is that **the hard problems are not in the CLI framework—they're in supervision, recovery, and merge coordination**. The recommended stack minimizes framework overhead so you can focus on those challenges:

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun v1.3.x | Native TS, fast spawn, built-in YAML/JSONL |
| Arg parsing | citty or commander | Subcommands, help gen, type-safe |
| Config | c12 + Zod v4 | Layered loading, schema validation |
| Logging | consola (TTY) + pino (overnight) | Dual-mode, structured JSON, rotation |
| Colors | picocolors | 7 KB, zero deps |
| Testing | bun:test + Bun Shell (`$`) | Native, fast, CLI E2E via shell |
| Linting | Biome 2.x | Single tool, 10–25× faster than ESLint |
| IPC | JSONL files + SQLite WAL | Hybrid: transcripts + coordination |
| Distribution | Compiled binary + npm | Homebrew tap + `bun add -g` |

The single biggest anti-pattern to avoid: **letting agents self-orchestrate**. Keep workflow logic deterministic in Bun, keep agent execution bounded and isolated, and build a watchdog from day one. Everything else is plumbing.