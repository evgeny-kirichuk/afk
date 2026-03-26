import type { ProviderInvocation, ProviderName, ProviderSessionInfo, TokenBreakdown } from "./types.ts";
import type { SessionStore } from "./session-store.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StreamEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

export interface ExecuteOptions {
  invocation: ProviderInvocation;
  sessionStore: SessionStore;
  sessionId: string;
  provider: ProviderName;
  timeoutMs?: number; // default: 3_600_000 (1 hour)
  signal?: AbortSignal;
  onEvent?: (event: StreamEvent) => void;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  providerSessionId: string | null;
  tokensUsed: number;
  tokenBreakdown: TokenBreakdown;
  durationMs: number;
}

// ── Provider Output Parsing ──────────────────────────────────────────────────

const ZERO_BREAKDOWN: TokenBreakdown = { input: 0, output: 0, cached: 0, thinking: 0, total: 0, premiumRequests: 0 };

export function parseProviderOutput(provider: ProviderName, raw: string): ProviderSessionInfo {
  const fallback: ProviderSessionInfo = { sessionId: null, tokensUsed: 0, tokenBreakdown: { ...ZERO_BREAKDOWN } };

  try {
    const json = JSON.parse(raw);

    switch (provider) {
      case "claude": {
        // Claude: input_tokens excludes cached; cache_read = served from cache, cache_creation = written to cache
        // input = total input context (non-cached + cached), for operational context-window tracking
        const nonCachedInput = json.usage?.input_tokens ?? 0;
        const cacheRead = json.usage?.cache_read_input_tokens ?? 0;
        const cacheCreation = json.usage?.cache_creation_input_tokens ?? 0;
        const input = nonCachedInput + cacheRead + cacheCreation;
        const output = json.usage?.output_tokens ?? 0;
        const cached = cacheRead;
        const total = input + output;
        return {
          sessionId: json.session_id ?? null,
          tokensUsed: total,
          tokenBreakdown: { input, output, cached, thinking: 0, total, premiumRequests: 0 },
        };
      }
      case "codex": {
        // Codex: input_tokens includes cached; cached_input_tokens is the subset served from cache
        const input = json.usage?.input_tokens ?? 0;
        const output = json.usage?.output_tokens ?? 0;
        const cached = json.usage?.cached_input_tokens ?? 0;
        const total = input + output;
        return {
          sessionId: json.thread_id ?? null,
          tokensUsed: total,
          tokenBreakdown: { input, output, cached, thinking: 0, total, premiumRequests: 0 },
        };
      }
      case "gemini": {
        // Gemini JSON: { stats: { models: { <name>: { tokens: { input, candidates, total, cached, thoughts } } } } }
        const models = json.stats?.models;
        const firstModel = models ? Object.values(models)[0] as any : null;
        const tokens = firstModel?.tokens;
        const input = tokens?.input ?? 0;
        const output = tokens?.candidates ?? 0;
        const cached = tokens?.cached ?? 0;
        const thinking = tokens?.thoughts ?? 0;
        const total = tokens?.total ?? (input + output + thinking);
        return {
          sessionId: json.session_id ?? null,
          tokensUsed: total,
          tokenBreakdown: { input, output, cached, thinking, total, premiumRequests: 0 },
        };
      }
      case "copilot": {
        // Copilot result event: { sessionId, usage: { premiumRequests } }
        const premiumRequests = json.usage?.premiumRequests ?? 0;
        return {
          sessionId: json.sessionId ?? null,
          tokensUsed: 0,
          tokenBreakdown: { ...ZERO_BREAKDOWN, premiumRequests },
        };
      }
    }
  } catch {
    return fallback;
  }
}

/** Parse the last complete JSON object from NDJSON output */
function parseLastJsonLine(raw: string): string | null {
  const lines = raw.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("{")) return line;
  }
  return null;
}

/** Sum a numeric field across all JSONL events matching a type */
function sumJsonlField(raw: string, type: string, path: (obj: any) => number): number {
  let sum = 0;
  for (const line of raw.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === type) sum += path(parsed) || 0;
    } catch { /* skip */ }
  }
  return sum;
}

/** Find a specific JSONL event by type field */
function findJsonlEvent(raw: string, type: string): string | null {
  const lines = raw.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === type) return line;
    } catch { /* skip malformed lines */ }
  }
  return null;
}

// ── Stream Reader ────────────────────────────────────────────────────────────

async function readStreamJson(
  stdout: ReadableStream<Uint8Array>,
  onEvent?: (event: StreamEvent) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stdout.getReader();
  let buffer = "";
  const lines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      // Last part may be incomplete — keep it in buffer
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line) continue;
        lines.push(line);

        if (onEvent) {
          try {
            const parsed = JSON.parse(line);
            onEvent({
              type: parsed.type ?? "unknown",
              data: parsed,
              timestamp: new Date().toISOString(),
            });
          } catch {
            // Non-JSON line, emit as raw text event
            onEvent({ type: "raw", data: line, timestamp: new Date().toISOString() });
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Flush any remaining buffer
  if (buffer.trim()) {
    lines.push(buffer.trim());
  }

  return lines.join("\n");
}

async function collectStdout(stdout: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stdout).text();
}

async function collectStderr(stderr: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stderr).text();
}

// ── Execute ──────────────────────────────────────────────────────────────────

export async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
  const { invocation, sessionStore, sessionId, provider, onEvent } = opts;
  const timeoutMs = opts.timeoutMs ?? 3_600_000;

  const start = performance.now();
  let killed = false;

  // Strip env vars that prevent nested CLI sessions (e.g. CLAUDECODE blocks child Claude processes)
  const { CLAUDECODE, ...baseEnv } = process.env;
  const proc = Bun.spawn([invocation.binary, ...invocation.args], {
    cwd: invocation.cwd,
    env: { ...baseEnv, ...invocation.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const killProc = () => {
    if (killed) return;
    killed = true;
    proc.kill(9); // SIGKILL to ensure immediate termination
  };

  // Timeout handling
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProc();
  }, timeoutMs);

  // AbortSignal handling
  if (opts.signal) {
    opts.signal.addEventListener("abort", killProc, { once: true });
  }

  // Start collecting output streams
  const stdoutPromise =
    invocation.outputFormat === "stream-json"
      ? readStreamJson(proc.stdout as ReadableStream<Uint8Array>, (event) => {
          sessionStore.addEvent(sessionId, event.type, event.data);
          onEvent?.(event);
        })
      : collectStdout(proc.stdout as ReadableStream<Uint8Array>);
  const stderrPromise = collectStderr(proc.stderr as ReadableStream<Uint8Array>);

  // Wait for process exit first — streams may not close on kill in Bun
  const exitCode = await proc.exited;
  clearTimeout(timer);

  // Remove abort listener to prevent late-firing signals from corrupting status
  if (opts.signal) {
    opts.signal.removeEventListener("abort", killProc);
  }

  // Snapshot kill state — after this point, late signals cannot affect the result
  const wasKilled = killed;
  const wasTimedOut = timedOut;

  // Race stream collection against a short deadline (streams should be done once process exits)
  const deadline = <T>(promise: Promise<T>, fallback: T, ms = 1000) =>
    Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

  const stdoutText = await deadline(stdoutPromise, "");
  const stderrText = await deadline(stderrPromise, "");

  const durationMs = Math.round(performance.now() - start);

  // Parse provider output — pick the right JSONL event for each provider
  let rawForParsing: string;
  if (invocation.outputFormat !== "stream-json") {
    rawForParsing = stdoutText;
  } else if (provider === "codex") {
    rawForParsing = findJsonlEvent(stdoutText, "turn.completed") ?? parseLastJsonLine(stdoutText) ?? stdoutText;
  } else if (provider === "copilot") {
    rawForParsing = findJsonlEvent(stdoutText, "result") ?? parseLastJsonLine(stdoutText) ?? stdoutText;
  } else {
    rawForParsing = parseLastJsonLine(stdoutText) ?? stdoutText;
  }
  const parsed = parseProviderOutput(provider, rawForParsing);

  // Copilot: enrich with output tokens summed from assistant.message events
  if (provider === "copilot" && invocation.outputFormat === "stream-json") {
    const outputTokens = sumJsonlField(stdoutText, "assistant.message", (e) => e.data?.outputTokens);
    parsed.tokenBreakdown.output = outputTokens;
    parsed.tokenBreakdown.total = outputTokens;
    parsed.tokensUsed = outputTokens;
  }

  // Determine status using snapshots taken before stream collection
  const status = wasTimedOut || wasKilled ? "failed" : exitCode === 0 ? "completed" : "failed";
  const errorMsg = wasTimedOut
    ? "timeout"
    : wasKilled
      ? "aborted"
      : exitCode !== 0
        ? stderrText.slice(0, 2000)
        : undefined;

  // Update session store
  sessionStore.updateSession(sessionId, {
    status,
    provider_session_id: parsed.sessionId,
    tokens_used: parsed.tokensUsed,
    ended_at: new Date().toISOString(),
  });

  if (errorMsg) {
    sessionStore.addEvent(sessionId, "error", { message: errorMsg, exitCode });
  }

  return {
    exitCode: wasTimedOut ? -1 : exitCode,
    stdout: stdoutText,
    stderr: stderrText,
    providerSessionId: parsed.sessionId,
    tokensUsed: parsed.tokensUsed,
    tokenBreakdown: parsed.tokenBreakdown,
    durationMs,
  };
}
