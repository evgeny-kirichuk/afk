import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SessionStore, runStep } from "@afk/core";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const FAKE_AGENT = resolve(import.meta.dir, "../spike/fake-agent.sh");

let store: SessionStore;
let tmpDir: string;
let afkDir: string;
let worktreeDir: string;

beforeEach(async () => {
  store = new SessionStore(":memory:");
  tmpDir = await mkdtemp(join(tmpdir(), "afk-test-"));
  afkDir = join(tmpDir, "afk");
  worktreeDir = join(tmpDir, "worktree");

  // Set up minimal directory structure
  await Bun.write(
    join(afkDir, "context", "steps", "implement.md"),
    `---
requires:
  - spec
tier: standard
---
# Implement

You are implementing a coding task.

## Spec
{{spec}}

## Memory
{{memory}}
`,
  );
  await Bun.write(join(afkDir, "context", "specs", "test-task.md"), "Build a hello world app");
  await Bun.write(join(afkDir, "MEMORY.md"), "User prefers TypeScript");

  // Create track directory
  await Bun.write(join(afkDir, "tracks", "track-1", ".gitkeep"), "");
});

afterEach(async () => {
  store.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("runStep", () => {
  test("full flow with fake agent", async () => {
    // Write step_complete.json that the fake agent would produce
    await Bun.write(
      join(afkDir, "tracks", "track-1", "step_complete.json"),
      JSON.stringify({
        step: "implement",
        task_id: "test-task",
        status: "completed",
        summary: "Built the hello world app",
        decisions: [{ ts: "2026-03-24T12:00:00Z", type: "decision", task: "test-task", detail: "Used Bun.serve" }],
      }),
    );

    const result = await runStep({
      step: "implement",
      taskId: "test-task",
      trackId: "track-1",
      afkDir,
      worktreeDir: tmpDir, // Use tmpDir as cwd since fake agent doesn't care
      provider: "claude",
      model: "test-model",
      sessionStore: store,
      binaryOverride: FAKE_AGENT,
    });

    expect(result.sessionId).toBeTruthy();
    expect(result.output.status).toBe("completed");
    expect(result.output.summary).toBe("Built the hello world app");
    expect(result.output.decisions).toHaveLength(1);

    // Session should exist in store
    const session = store.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session!.task_id).toBe("test-task");
    expect(session!.track_id).toBe("track-1");
    expect(session!.step).toBe("implement");
    expect(session!.provider).toBe("claude");
  });

  test("missing template throws", async () => {
    expect(
      runStep({
        step: "analyze", // No template for this step
        taskId: "test-task",
        trackId: "track-1",
        afkDir,
        worktreeDir: tmpDir,
        provider: "claude",
        model: "test-model",
        sessionStore: store,
        binaryOverride: FAKE_AGENT,
      }),
    ).rejects.toThrow("Step template not found");
  });

  test("missing spec throws", async () => {
    expect(
      runStep({
        step: "implement",
        taskId: "nonexistent-task",
        trackId: "track-1",
        afkDir,
        worktreeDir: tmpDir,
        provider: "claude",
        model: "test-model",
        sessionStore: store,
        binaryOverride: FAKE_AGENT,
      }),
    ).rejects.toThrow("Task spec not found");
  });

  test("no step_complete.json with exit 0 produces minimal output", async () => {
    // Don't write step_complete.json — agent succeeded but didn't write it
    const result = await runStep({
      step: "implement",
      taskId: "test-task",
      trackId: "track-1",
      afkDir,
      worktreeDir: tmpDir,
      provider: "claude",
      model: "test-model",
      sessionStore: store,
      binaryOverride: FAKE_AGENT,
    });

    expect(result.output.status).toBe("completed");
    expect(result.output.summary).toContain("no step_complete.json");
  });

  test("invalid step_complete.json produces failed output", async () => {
    await Bun.write(
      join(afkDir, "tracks", "track-1", "step_complete.json"),
      JSON.stringify({ invalid: "data" }), // Missing required fields
    );

    const result = await runStep({
      step: "implement",
      taskId: "test-task",
      trackId: "track-1",
      afkDir,
      worktreeDir: tmpDir,
      provider: "claude",
      model: "test-model",
      sessionStore: store,
      binaryOverride: FAKE_AGENT,
    });

    expect(result.output.status).toBe("failed");
    expect(result.output.error).toBe("invalid_step_output");
  });

  test("creates session with parent when provided", async () => {
    // Create parent session first
    store.createSession({
      id: "parent-session",
      track_id: "track-1",
      task_id: "test-task",
      step: "review",
      provider: "claude",
      model: "test-model",
    });

    const result = await runStep({
      step: "implement",
      taskId: "test-task",
      trackId: "track-1",
      afkDir,
      worktreeDir: tmpDir,
      provider: "claude",
      model: "test-model",
      sessionStore: store,
      parentSessionId: "parent-session",
      binaryOverride: FAKE_AGENT,
    });

    const session = store.getSession(result.sessionId);
    expect(session!.parent_session_id).toBe("parent-session");

    const children = store.getChildSessions("parent-session");
    expect(children).toHaveLength(1);
    expect(children[0]!.id).toBe(result.sessionId);
  });
});
