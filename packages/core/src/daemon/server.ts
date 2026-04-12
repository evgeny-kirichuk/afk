// ── Daemon HTTP + SSE Server ────────────────────────────────────────────────
// Single Bun.serve() process: REST for commands, SSE for real-time events.

// Bun.serve() return type
import { type DaemonEvent, EventBus } from "./event-bus.ts";
import { GlobalStore, globalDbPath } from "./global-store.ts";
import { defaultPidPath, removePidFile, writePidFile } from "./pid.ts";

export interface DaemonOptions {
  port?: number;
  hostname?: string;
  dbPath?: string;
  pidPath?: string;
}

export interface DaemonServer {
  server: ReturnType<typeof Bun.serve>;
  store: GlobalStore;
  eventBus: EventBus;
  stop: () => void;
}

export function startDaemon(opts: DaemonOptions = {}): DaemonServer {
  const port = opts.port ?? (Number(process.env.AFK_PORT) || 4117);
  const hostname = opts.hostname ?? "127.0.0.1";
  const dbPath = opts.dbPath ?? globalDbPath();
  const pidPath = opts.pidPath ?? defaultPidPath();

  const store = new GlobalStore(dbPath);
  const eventBus = new EventBus();

  // ── Route Helpers ───────────────────────────────────────────────────────

  function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function error(message: string, status = 400): Response {
    return json({ error: message }, status);
  }

  // ── SSE Handler ─────────────────────────────────────────────────────────

  function handleSSE(): Response {
    let unsubscribe: (() => void) | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();

        // Send initial connection event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`,
          ),
        );

        unsubscribe = eventBus.subscribe((event: DaemonEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Client disconnected — unsubscribe will happen in cancel
          }
        });

        // SSE keepalive comment every 15s — standard pattern that keeps
        // the connection alive across proxies/middleboxes. Clients ignore
        // lines starting with ':' per the SSE spec.
        keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch {
            // Client gone
          }
        }, 15_000);
      },
      cancel() {
        unsubscribe?.();
        if (keepalive) clearInterval(keepalive);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // ── Route Dispatch ──────────────────────────────────────────────────────

  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    // SSE endpoint
    if (pathname === "/events" && method === "GET") {
      return handleSSE();
    }

    // Health / status
    if (pathname === "/api/status" && method === "GET") {
      return json({
        status: "running",
        pid: process.pid,
        port,
        uptime: process.uptime(),
        repos: store.listRepos().length,
        sseClients: eventBus.listenerCount,
      });
    }

    // List repos
    if (pathname === "/api/repos" && method === "GET") {
      return json({ repos: store.listRepos() });
    }

    // Register repo
    if (pathname === "/api/repos" && method === "POST") {
      let body: { name?: string; path?: string };
      try {
        body = (await req.json()) as { name?: string; path?: string };
      } catch {
        return error("invalid JSON body");
      }
      if (!body.name || !body.path) {
        return error("name and path are required");
      }
      const { repo, created } = store.registerRepo(body.name, body.path);
      if (created) {
        eventBus.emit("repo-registered", { name: repo.name, path: repo.path });
      }
      return json({ repo, created }, created ? 201 : 200);
    }

    // Remove repo
    if (pathname.startsWith("/api/repos/") && method === "DELETE") {
      const nameOrPath = decodeURIComponent(pathname.slice("/api/repos/".length));
      const removed = store.removeRepo(nameOrPath);
      if (!removed) return error("repo not found", 404);
      eventBus.emit("repo-removed", { nameOrPath });
      return json({ removed: true });
    }

    // Shutdown
    if (pathname === "/api/shutdown" && method === "POST") {
      eventBus.emit("daemon-stopping", {});
      // Defer shutdown to let the response be sent
      setTimeout(() => stop(), 100);
      return json({ status: "shutting-down" });
    }

    return error("not found", 404);
  }

  // ── Start Server ────────────────────────────────────────────────────────

  const server = Bun.serve({
    port,
    hostname,
    // Disable per-socket idle timeout — SSE clients hold connections open
    // indefinitely, and this is a local-only daemon.
    idleTimeout: 0,
    fetch: handleRequest,
  });

  const actualPort = server.port ?? port;

  // Write PID file
  writePidFile(pidPath, {
    pid: process.pid,
    port: actualPort,
    startedAt: new Date().toISOString(),
  });

  eventBus.emit("daemon-started", { pid: process.pid, port: actualPort });

  function stop() {
    eventBus.emit("daemon-stopped", {});
    eventBus.clear();
    server.stop(true);
    store.close();
    removePidFile(pidPath);
  }

  return { server, store, eventBus, stop };
}
