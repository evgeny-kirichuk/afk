// ── Daemon HTTP Client ──────────────────────────────────────────────────────
// Thin client for CLI → daemon communication.

import { defaultPidPath, isDaemonRunning, type PidInfo } from "@afk/core";

export class DaemonClient {
  private baseUrl: string;

  constructor(port?: number) {
    const p = port ?? (Number(process.env.AFK_PORT) || 4117);
    this.baseUrl = `http://127.0.0.1:${p}`;
  }

  /** Check if daemon is reachable */
  static check(pidPath?: string): PidInfo | null {
    return isDaemonRunning(pidPath ?? defaultPidPath());
  }

  /** Require daemon to be running, or exit with a message */
  static requireRunning(pidPath?: string): PidInfo {
    const info = DaemonClient.check(pidPath);
    if (!info) {
      console.error("Daemon is not running. Start it with: afk daemon start");
      process.exit(1);
    }
    return info;
  }

  private async request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, init);
      const body = await res.json();
      if (!res.ok) {
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
      return body as T;
    } catch (e: any) {
      if (e.code === "ECONNREFUSED" || e.message?.includes("ECONNREFUSED")) {
        throw new Error("Daemon is not running. Start it with: afk daemon start");
      }
      throw e;
    }
  }

  async status(): Promise<{
    status: string;
    pid: number;
    port: number;
    uptime: number;
    repos: number;
    sseClients: number;
  }> {
    return this.request("/api/status");
  }

  async listRepos(): Promise<{
    repos: Array<{ id: number; name: string; path: string; registered_at: string }>;
  }> {
    return this.request("/api/repos");
  }

  async registerRepo(
    name: string,
    path: string,
  ): Promise<{
    repo: { id: number; name: string; path: string; registered_at: string };
    created: boolean;
  }> {
    return this.request("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, path }),
    });
  }

  async shutdown(): Promise<{ status: string }> {
    return this.request("/api/shutdown", { method: "POST" });
  }
}
