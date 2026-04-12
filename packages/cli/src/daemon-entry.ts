#!/usr/bin/env bun
// ── Daemon Entry Point ──────────────────────────────────────────────────────
// Standalone script spawned by `afk daemon start` as a detached process.
// Reads port from AFK_PORT env or defaults to 4117.

import { startDaemon } from "@afk/core";

const port = Number(process.env.AFK_PORT) || 4117;

const daemon = startDaemon({ port });

console.log(`afk daemon running on http://127.0.0.1:${daemon.server.port} (pid ${process.pid})`);

// Keep process alive — Bun.serve() keeps the event loop running.
// Handle graceful shutdown on signals.
process.on("SIGTERM", () => {
  console.log("afk daemon received SIGTERM, shutting down...");
  daemon.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("afk daemon received SIGINT, shutting down...");
  daemon.stop();
  process.exit(0);
});
