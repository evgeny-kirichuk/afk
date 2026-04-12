#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: { name: "afk", version: "0.0.1", description: "Supervisor for autonomous coding agents" },
  subCommands: {
    daemon: () => import("./commands/daemon.ts").then((m) => m.default),
    init: () => import("./commands/init.ts").then((m) => m.default),
    start: () => import("./commands/start.ts").then((m) => m.default),
    status: () => import("./commands/status.ts").then((m) => m.default),
    "run-step": () => import("./commands/run-step.ts").then((m) => m.default),
  },
});

runMain(main);
