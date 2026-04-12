import { resolve } from "node:path";
import { defaultPidPath, isDaemonRunning } from "@afk/core";
import { defineCommand } from "citty";
import { DaemonClient } from "../client.ts";

export default defineCommand({
  meta: { name: "daemon", description: "Manage the AFK daemon" },
  subCommands: {
    start: defineCommand({
      meta: { name: "start", description: "Start the daemon" },
      args: {
        port: { type: "string", description: "Port to listen on", default: "4117" },
        foreground: {
          type: "boolean",
          description: "Run in foreground (don't detach)",
          default: false,
        },
      },
      async run({ args }) {
        const pidPath = defaultPidPath();
        const existing = isDaemonRunning(pidPath);
        if (existing) {
          console.log(`Daemon already running (pid ${existing.pid}, port ${existing.port})`);
          return;
        }

        const port = args.port;

        if (args.foreground) {
          // Run in foreground — import and start directly
          const { startDaemon } = await import("@afk/core");
          const daemon = startDaemon({ port: Number(port) });
          console.log(
            `afk daemon running on http://127.0.0.1:${daemon.server.port} (pid ${process.pid})`,
          );
          console.log("Press Ctrl+C to stop");

          // Clean up PID file and close server on Ctrl+C / kill
          const shutdown = (signal: string) => {
            console.log(`\nafk daemon received ${signal}, shutting down...`);
            daemon.stop();
            process.exit(0);
          };
          process.on("SIGINT", () => shutdown("SIGINT"));
          process.on("SIGTERM", () => shutdown("SIGTERM"));
          return;
        }

        // Spawn detached background process
        const entryPoint = resolve(import.meta.dir, "../daemon-entry.ts");
        const proc = Bun.spawn(["bun", "run", entryPoint], {
          env: { ...process.env, AFK_PORT: port },
          stdio: ["ignore", "ignore", "ignore"],
        });
        proc.unref();

        // Wait briefly for the daemon to write its PID file
        await Bun.sleep(500);
        const info = isDaemonRunning(pidPath);
        if (info) {
          console.log(`Daemon started (pid ${info.pid}, port ${info.port})`);
        } else {
          console.error("Daemon may have failed to start. Check logs.");
          process.exit(1);
        }
      },
    }),

    stop: defineCommand({
      meta: { name: "stop", description: "Stop the daemon" },
      async run() {
        const info = DaemonClient.check();
        if (!info) {
          console.log("Daemon is not running.");
          return;
        }

        try {
          const client = new DaemonClient(info.port);
          await client.shutdown();
          console.log("Daemon stopping...");
        } catch {
          // If HTTP fails, try killing directly
          try {
            process.kill(info.pid, "SIGTERM");
            console.log(`Sent SIGTERM to daemon (pid ${info.pid})`);
          } catch {
            console.error("Could not stop daemon.");
          }
        }
      },
    }),

    status: defineCommand({
      meta: { name: "status", description: "Check daemon status" },
      async run() {
        const info = DaemonClient.check();
        if (!info) {
          console.log("Daemon is not running.");
          return;
        }

        try {
          const client = new DaemonClient(info.port);
          const status = await client.status();
          console.log(`Daemon: running`);
          console.log(`  PID:         ${status.pid}`);
          console.log(`  Port:        ${status.port}`);
          console.log(`  Uptime:      ${Math.round(status.uptime)}s`);
          console.log(`  Repos:       ${status.repos}`);
          console.log(`  SSE clients: ${status.sseClients}`);
        } catch (e: any) {
          console.log(`Daemon PID file exists (pid ${info.pid}) but not responding.`);
        }
      },
    }),
  },
});
