import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SessionStore, execute, parseProviderOutput, type StreamEvent } from "@afk/core";
import type { ProviderInvocation } from "@afk/core";
import { resolve } from "node:path";

const FAKE_AGENT = resolve(import.meta.dir, "../spike/fake-agent.sh");

let store: SessionStore;

beforeEach(() => {
  store = new SessionStore(":memory:");
  store.createSession({
    id: "test-session",
    track_id: "track-1",
    task_id: "task-1",
    step: "implement",
    provider: "claude",
    model: "test-model",
  });
});

afterEach(() => {
  store.close();
});

function makeInvocation(overrides: Partial<ProviderInvocation> & { extraArgs?: string[] } = {}): ProviderInvocation {
  return {
    binary: FAKE_AGENT,
    args: overrides.extraArgs ?? [],
    cwd: process.cwd(),
    env: {},
    outputFormat: overrides.outputFormat ?? "json",
  };
}

// ── parseProviderOutput ──────────────────────────────────────────────────────

describe("parseProviderOutput", () => {
  test("parses Claude JSON output", () => {
    const raw = JSON.stringify({
      session_id: "uuid-123",
      result: "Hello",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const info = parseProviderOutput("claude", raw);
    expect(info.sessionId).toBe("uuid-123");
    expect(info.tokensUsed).toBe(150);
  });

  test("returns fallback on invalid JSON", () => {
    const info = parseProviderOutput("claude", "not json");
    expect(info.sessionId).toBeNull();
    expect(info.tokensUsed).toBe(0);
  });

  test("handles missing fields gracefully", () => {
    const info = parseProviderOutput("claude", "{}");
    expect(info.sessionId).toBeNull();
    expect(info.tokensUsed).toBe(0);
  });
});

// ── execute ──────────────────────────────────────────────────────────────────

describe("execute", () => {
  test("successful json execution", async () => {
    const result = await execute({
      invocation: makeInvocation({ extraArgs: ["--mode", "json"] }),
      sessionStore: store,
      sessionId: "test-session",
      provider: "claude",
    });

    expect(result.exitCode).toBe(0);
    expect(result.providerSessionId).toBe("fake-session-123");
    expect(result.tokensUsed).toBe(150);
    expect(result.durationMs).toBeGreaterThan(0);

    // Session should be updated
    const session = store.getSession("test-session");
    expect(session!.status).toBe("completed");
    expect(session!.tokens_used).toBe(150);
    expect(session!.provider_session_id).toBe("fake-session-123");
    expect(session!.ended_at).not.toBeNull();
  });

  test("stream-json execution fires onEvent", async () => {
    const events: StreamEvent[] = [];

    const result = await execute({
      invocation: makeInvocation({ outputFormat: "stream-json", extraArgs: ["--mode", "stream-json"] }),
      sessionStore: store,
      sessionId: "test-session",
      provider: "claude",
      onEvent: (e) => events.push(e),
    });

    expect(result.exitCode).toBe(0);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0]!.type).toBe("assistant");
    expect(events[1]!.type).toBe("tool_use");
    expect(events[2]!.type).toBe("result");

    // Events should be stored in the session store
    const storedEvents = store.getEvents("test-session");
    expect(storedEvents.length).toBeGreaterThanOrEqual(3);
  });

  test("non-zero exit code captures error", async () => {
    const result = await execute({
      invocation: makeInvocation({ extraArgs: ["--mode", "json", "--exit-code", "1"] }),
      sessionStore: store,
      sessionId: "test-session",
      provider: "claude",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("simulated failure");

    const session = store.getSession("test-session");
    expect(session!.status).toBe("failed");

    // Error event should be stored
    const events = store.getEvents("test-session");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeTruthy();
  });

  test("timeout kills process", async () => {
    const result = await execute({
      invocation: makeInvocation({ extraArgs: ["--sleep"] }),
      sessionStore: store,
      sessionId: "test-session",
      provider: "claude",
      timeoutMs: 500,
    });

    expect(result.exitCode).toBe(-1);

    const session = store.getSession("test-session");
    expect(session!.status).toBe("failed");
  }, 10_000);

  test("abort signal kills process", async () => {
    const controller = new AbortController();

    // Abort after 200ms
    setTimeout(() => controller.abort(), 200);

    const result = await execute({
      invocation: makeInvocation({ extraArgs: ["--sleep"] }),
      sessionStore: store,
      sessionId: "test-session",
      provider: "claude",
      signal: controller.signal,
    });

    // Process was killed — exit code is non-zero
    expect(result.exitCode).not.toBe(0);
  }, 10_000);
});
