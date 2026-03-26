import { describe, expect, test } from "bun:test";
import {
  SessionStore,
  buildInvocation,
  detectProviders,
  execute,
  type ExecuteResult,
  type StreamEvent,
  type ProviderName,
} from "@afk/core";

const SKIP_INTEGRATION = process.env.AFK_RUN_INTEGRATION !== "1";

describe.skipIf(SKIP_INTEGRATION)("CLI smoke tests", () => {
  let store: SessionStore;
  let availableProviders: Set<ProviderName>;

  test("detect providers", async () => {
    store = new SessionStore(":memory:");
    const providers = await detectProviders();
    availableProviders = new Set<ProviderName>();
    for (const [name, config] of providers) {
      if (config.available) {
        availableProviders.add(name);
        console.log(`  ✓ ${name} ${config.version ?? "(no version)"}`);
      }
    }
    expect(availableProviders.size).toBeGreaterThan(0);
  }, 15_000);

  // ── Helper: create a session and run a simple math prompt ──────────────

  function createSession(provider: ProviderName, model: string) {
    const sessionId = crypto.randomUUID();
    store.createSession({
      id: sessionId,
      track_id: "smoke",
      task_id: "smoke",
      step: "implement",
      provider,
      model,
    });
    return sessionId;
  }

  /** Format token breakdown for test output */
  function logTokens(label: string, result: ExecuteResult) {
    const b = result.tokenBreakdown;
    const parts = [`exit: ${result.exitCode}`];
    parts.push(`in: ${b.input}`);
    parts.push(`out: ${b.output}`);
    if (b.cached > 0) parts.push(`cached: ${b.cached}`);
    if (b.thinking > 0) parts.push(`thinking: ${b.thinking}`);
    parts.push(`total: ${b.total}`);
    if (b.premiumRequests > 0) parts.push(`premium: ${b.premiumRequests}`);
    console.log(`  ${label}:`, parts.join(" | "));
  }

  /** Extract text answer from JSON output (handles different provider response shapes) */
  function extractAnswer(stdout: string): string {
    try {
      const json = JSON.parse(stdout);
      return json.result ?? json.content ?? json.message ?? JSON.stringify(json);
    } catch {
      // Some providers return plain text or JSONL — return raw stdout
      return stdout;
    }
  }

  // ── Claude ─────────────────────────────────────────────────────────────

  test("claude json output", async () => {
    if (!availableProviders?.has("claude")) {
      console.log("  ⏭ claude not available, skipping");
      return;
    }

    const sessionId = createSession("claude", "claude-haiku-4-5");
    const invocation = buildInvocation("claude", {
      prompt: "What is 2+2? Reply with just the number, nothing else.",
      model: "claude-haiku-4-5",
      outputFormat: "json",
      dangerousAutoApprove: true,
      cwd: process.cwd(),
    });

    const result = await execute({
      invocation,
      sessionStore: store,
      sessionId,
      provider: "claude",
      timeoutMs: 60_000,
    });

    logTokens("claude/json", result);
    expect(result.exitCode).toBe(0);
    expect(extractAnswer(result.stdout)).toContain("4");
  }, 60_000);

  test("claude stream-json output", async () => {
    if (!availableProviders?.has("claude")) {
      console.log("  ⏭ claude not available, skipping");
      return;
    }

    const sessionId = createSession("claude", "claude-haiku-4-5");
    const events: StreamEvent[] = [];
    const invocation = buildInvocation("claude", {
      prompt: "What is 3+3? Reply with just the number, nothing else.",
      model: "claude-haiku-4-5",
      outputFormat: "stream-json",
      dangerousAutoApprove: true,
      cwd: process.cwd(),
    });

    const result = await execute({
      invocation,
      sessionStore: store,
      sessionId,
      provider: "claude",
      timeoutMs: 60_000,
      onEvent: (e) => events.push(e),
    });

    logTokens(`claude/stream (${events.length} events)`, result);
    expect(result.exitCode).toBe(0);
    expect(events.length).toBeGreaterThan(0);

    // Verify the answer appears in the streamed events
    const allText = events.map((e) => JSON.stringify(e.data)).join(" ");
    expect(allText).toContain("6");
  }, 60_000);

  test("claude session resume", async () => {
    if (!availableProviders?.has("claude")) {
      console.log("  ⏭ claude not available, skipping");
      return;
    }

    // First call
    const sessionId1 = createSession("claude", "claude-haiku-4-5");
    const inv1 = buildInvocation("claude", {
      prompt: "What is 2+2? Reply with just the number, nothing else.",
      model: "claude-haiku-4-5",
      outputFormat: "json",
      dangerousAutoApprove: true,
      cwd: process.cwd(),
    });

    const result1 = await execute({
      invocation: inv1,
      sessionStore: store,
      sessionId: sessionId1,
      provider: "claude",
      timeoutMs: 60_000,
    });

    expect(result1.exitCode).toBe(0);
    expect(result1.providerSessionId).toBeTruthy();
    expect(extractAnswer(result1.stdout)).toContain("4");

    // Second call — resume and multiply
    const sessionId2 = createSession("claude", "claude-haiku-4-5");
    const inv2 = buildInvocation("claude", {
      prompt: "Multiply your previous answer by 3. Reply with just the number, nothing else.",
      model: "claude-haiku-4-5",
      outputFormat: "json",
      dangerousAutoApprove: true,
      cwd: process.cwd(),
      resumeSessionId: result1.providerSessionId!,
    });

    const result2 = await execute({
      invocation: inv2,
      sessionStore: store,
      sessionId: sessionId2,
      provider: "claude",
      timeoutMs: 60_000,
    });

    logTokens("claude/resume", result2);
    expect(result2.exitCode).toBe(0);
    expect(extractAnswer(result2.stdout)).toContain("12");
  }, 120_000);

  // ── Codex ──────────────────────────────────────────────────────────────

  test("codex json output", async () => {
    if (!availableProviders?.has("codex")) {
      console.log("  ⏭ codex not available, skipping");
      return;
    }

    const sessionId = createSession("codex", "gpt-5.1-codex-mini");
    const invocation = buildInvocation("codex", {
      prompt: "What is 5+5? Reply with just the number, nothing else.",
      model: "gpt-5.1-codex-mini",
      outputFormat: "json",
      dangerousAutoApprove: true,
      cwd: process.cwd(),
    });

    const result = await execute({
      invocation,
      sessionStore: store,
      sessionId,
      provider: "codex",
      timeoutMs: 60_000,
    });

    logTokens("codex", result);
    expect(result.exitCode).toBe(0);
    expect(extractAnswer(result.stdout)).toContain("10");
  }, 60_000);

  // ── Gemini ─────────────────────────────────────────────────────────────

  test("gemini json output", async () => {
    if (!availableProviders?.has("gemini")) {
      console.log("  ⏭ gemini not available, skipping");
      return;
    }

    const sessionId = createSession("gemini", "gemini-2.5-flash-lite");
    const invocation = buildInvocation("gemini", {
      prompt: "What is 7+7? Reply with just the number, nothing else.",
      model: "gemini-2.5-flash-lite",
      outputFormat: "json",
      dangerousAutoApprove: true,
      cwd: process.cwd(),
    });

    const result = await execute({
      invocation,
      sessionStore: store,
      sessionId,
      provider: "gemini",
      timeoutMs: 60_000,
    });

    logTokens("gemini", result);
    expect(result.exitCode).toBe(0);
    expect(extractAnswer(result.stdout)).toContain("14");
  }, 60_000);

  // ── Copilot ────────────────────────────────────────────────────────────

  test("copilot json output", async () => {
    if (!availableProviders?.has("copilot")) {
      console.log("  ⏭ copilot not available, skipping");
      return;
    }

    const sessionId = createSession("copilot", "gpt-4.1");
    const invocation = buildInvocation("copilot", {
      prompt: "What is 8+8? Reply with just the number, nothing else.",
      model: "gpt-4.1",
      outputFormat: "json",
      dangerousAutoApprove: true,
      cwd: process.cwd(),
    });

    const result = await execute({
      invocation,
      sessionStore: store,
      sessionId,
      provider: "copilot",
      timeoutMs: 60_000,
    });

    logTokens("copilot", result);
    expect(result.exitCode).toBe(0);
    expect(extractAnswer(result.stdout)).toContain("16");
  }, 60_000);

  // ── Cleanup ────────────────────────────────────────────────────────────

  test("cleanup", () => {
    store?.close();
  });
});
