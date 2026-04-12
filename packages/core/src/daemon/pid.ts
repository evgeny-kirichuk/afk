// ── PID File Management ─────────────────────────────────────────────────────
// Tracks daemon process lifecycle via ~/.afk/daemon.pid

import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export function defaultPidPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return `${home}/.afk/daemon.pid`;
}

export interface PidInfo {
  pid: number;
  port: number;
  startedAt: string;
}

export function writePidFile(path: string, info: PidInfo): void {
  mkdirSync(dirname(path), { recursive: true });
  Bun.write(path, JSON.stringify(info));
}

export function readPidFile(path: string): PidInfo | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as PidInfo;
  } catch {
    return null;
  }
}

export function removePidFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone — fine
  }
}

/** Check if a PID is alive */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

/** Read PID file and verify the process is still running */
export function isDaemonRunning(pidPath: string): PidInfo | null {
  const info = readPidFile(pidPath);
  if (!info) return null;
  if (!isProcessAlive(info.pid)) {
    // Stale PID file — clean it up
    removePidFile(pidPath);
    return null;
  }
  return info;
}
