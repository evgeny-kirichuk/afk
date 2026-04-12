import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DaemonServer,
  EventBus,
  GlobalStore,
  isDaemonRunning,
  readPidFile,
  removePidFile,
  startDaemon,
  writePidFile,
} from "@afk/core";

// ── EventBus ────────────────────────────────────────────────────────────────

describe("EventBus", () => {
  test("subscribe receives emitted events", () => {
    const bus = new EventBus();
    const received: unknown[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit("test", { msg: "hello" });

    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe("test");
    expect((received[0] as any).data).toEqual({ msg: "hello" });
    expect((received[0] as any).timestamp).toBeDefined();
  });

  test("unsubscribe stops receiving", () => {
    const bus = new EventBus();
    const received: unknown[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    bus.emit("a", {});
    unsub();
    bus.emit("b", {});

    expect(received).toHaveLength(1);
  });

  test("listenerCount tracks subscribers", () => {
    const bus = new EventBus();
    expect(bus.listenerCount).toBe(0);

    const unsub1 = bus.subscribe(() => {});
    const unsub2 = bus.subscribe(() => {});
    expect(bus.listenerCount).toBe(2);

    unsub1();
    expect(bus.listenerCount).toBe(1);

    bus.clear();
    expect(bus.listenerCount).toBe(0);
  });

  test("failing listener does not break broadcast", () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((e) => received.push(e));

    bus.emit("test", {});
    expect(received).toHaveLength(1);
  });
});

// ── GlobalStore ─────────────────────────────────────────────────────────────

describe("GlobalStore", () => {
  let tmpDir: string;
  let store: GlobalStore;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "afk-test-"));
    store = new GlobalStore(join(tmpDir, "test.db"));
  });

  afterAll(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("registerRepo creates a repo entry", () => {
    const { repo, created } = store.registerRepo("my-app", "/tmp/my-app");
    expect(repo.name).toBe("my-app");
    expect(repo.path).toBe("/tmp/my-app");
    expect(repo.registered_at).toBeDefined();
    expect(created).toBe(true);
  });

  test("registerRepo is idempotent: returns created=false and keeps original row", () => {
    const { repo, created } = store.registerRepo("renamed", "/tmp/my-app");
    expect(created).toBe(false);
    // Name is NOT updated — original row is preserved
    expect(repo.name).toBe("my-app");

    const matching = store.listRepos().filter((r) => r.path === "/tmp/my-app");
    expect(matching).toHaveLength(1);
    expect(matching[0]!.name).toBe("my-app");
  });

  test("registerRepo allows duplicate name on different path", () => {
    store.registerRepo("shared-name", "/tmp/dup-a");
    const second = store.registerRepo("shared-name", "/tmp/dup-b");
    expect(second.created).toBe(true);

    const withName = store.listRepos().filter((r) => r.name === "shared-name");
    expect(withName).toHaveLength(2);
  });

  test("getRepo finds by name", () => {
    const repo = store.getRepo("my-app");
    expect(repo).not.toBeNull();
    expect(repo!.path).toBe("/tmp/my-app");
  });

  test("getRepo finds by path", () => {
    const repo = store.getRepo("/tmp/my-app");
    expect(repo).not.toBeNull();
  });

  test("getRepo returns null for unknown", () => {
    expect(store.getRepo("nonexistent")).toBeNull();
  });

  test("listRepos returns all repos", () => {
    store.registerRepo("second", "/tmp/second");
    const repos = store.listRepos();
    expect(repos.length).toBeGreaterThanOrEqual(2);
  });

  test("removeRepo deletes by name", () => {
    expect(store.removeRepo("second")).toBe(true);
    expect(store.getRepo("second")).toBeNull();
  });

  test("removeRepo returns false for unknown", () => {
    expect(store.removeRepo("nope")).toBe(false);
  });
});

// ── PID File ────────────────────────────────────────────────────────────────

describe("PID file", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "afk-pid-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("write and read round-trips", () => {
    const pidPath = join(tmpDir, "test.pid");
    writePidFile(pidPath, { pid: 12345, port: 4117, startedAt: "2026-01-01T00:00:00Z" });

    const info = readPidFile(pidPath);
    expect(info).not.toBeNull();
    expect(info!.pid).toBe(12345);
    expect(info!.port).toBe(4117);
  });

  test("readPidFile returns null for missing file", () => {
    expect(readPidFile(join(tmpDir, "nope.pid"))).toBeNull();
  });

  test("removePidFile cleans up", () => {
    const pidPath = join(tmpDir, "remove.pid");
    writePidFile(pidPath, { pid: 1, port: 1, startedAt: "" });
    removePidFile(pidPath);
    expect(existsSync(pidPath)).toBe(false);
  });

  test("isDaemonRunning detects stale PID", () => {
    const pidPath = join(tmpDir, "stale.pid");
    // Use a PID that almost certainly doesn't exist
    writePidFile(pidPath, { pid: 999999999, port: 4117, startedAt: "" });

    const result = isDaemonRunning(pidPath);
    expect(result).toBeNull();
    // Should have cleaned up the stale file
    expect(existsSync(pidPath)).toBe(false);
  });

  test("isDaemonRunning detects current process", () => {
    const pidPath = join(tmpDir, "alive.pid");
    writePidFile(pidPath, { pid: process.pid, port: 4117, startedAt: "" });

    const result = isDaemonRunning(pidPath);
    expect(result).not.toBeNull();
    expect(result!.pid).toBe(process.pid);

    removePidFile(pidPath);
  });
});

// ── Daemon Server ───────────────────────────────────────────────────────────

describe("Daemon server", () => {
  let tmpDir: string;
  let daemon: DaemonServer;
  let baseUrl: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "afk-daemon-test-"));
    daemon = startDaemon({
      port: 0, // random available port
      dbPath: join(tmpDir, "test.db"),
      pidPath: join(tmpDir, "test.pid"),
    });
    baseUrl = `http://127.0.0.1:${daemon.server.port}`;
  });

  afterAll(() => {
    daemon.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /api/status returns daemon info", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("running");
    expect(body.pid).toBe(process.pid);
    expect(typeof body.uptime).toBe("number");
  });

  test("GET /api/repos returns empty list initially", async () => {
    const res = await fetch(`${baseUrl}/api/repos`);
    const body = (await res.json()) as any;
    expect(body.repos).toEqual([]);
  });

  test("POST /api/repos registers a repo", async () => {
    const res = await fetch(`${baseUrl}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-repo", path: "/tmp/test-repo" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.repo.name).toBe("test-repo");
    expect(body.created).toBe(true);
  });

  test("GET /api/repos lists registered repos", async () => {
    const res = await fetch(`${baseUrl}/api/repos`);
    const body = (await res.json()) as any;
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].name).toBe("test-repo");
  });

  test("POST /api/repos returns 200 + created=false on re-register", async () => {
    const res = await fetch(`${baseUrl}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-repo", path: "/tmp/test-repo" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(false);
    expect(body.repo.name).toBe("test-repo");
  });

  test("POST /api/repos rejects missing fields", async () => {
    const res = await fetch(`${baseUrl}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "only-name" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/repos rejects malformed JSON", async () => {
    const res = await fetch(`${baseUrl}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("invalid JSON body");
  });

  test("DELETE /api/repos/:name removes a repo", async () => {
    const res = await fetch(`${baseUrl}/api/repos/test-repo`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const list = await fetch(`${baseUrl}/api/repos`);
    const body = (await list.json()) as any;
    expect(body.repos).toHaveLength(0);
  });

  test("DELETE /api/repos/:name returns 404 for unknown", async () => {
    const res = await fetch(`${baseUrl}/api/repos/unknown`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/nothing`);
    expect(res.status).toBe(404);
  });

  test("GET /events returns SSE stream", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/events`, {
      signal: controller.signal,
    });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    // Read the first event (connection event)
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain('"type":"connected"');

    controller.abort();
    reader.releaseLock();
  });

  test("SSE receives events emitted after connection", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/events`, {
      signal: controller.signal,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read connection event
    await reader.read();

    // Emit a custom event
    daemon.eventBus.emit("test-event", { key: "value" });

    // Read the custom event
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain('"type":"test-event"');
    expect(text).toContain('"key":"value"');

    controller.abort();
    reader.releaseLock();
  });
});
