import { defineCommand } from "citty";
import { DaemonClient } from "../client.ts";

export default defineCommand({
  meta: { name: "status", description: "Show AFK status" },
  async run() {
    const info = DaemonClient.check();
    if (!info) {
      console.log("Daemon is not running. Start it with: afk daemon start");
      return;
    }

    const client = new DaemonClient(info.port);

    try {
      const [status, { repos }] = await Promise.all([client.status(), client.listRepos()]);

      console.log(
        `Daemon: running (pid ${status.pid}, port ${status.port}, uptime ${Math.round(status.uptime)}s)`,
      );
      console.log();

      if (repos.length === 0) {
        console.log("No repos registered. Run `afk init` inside a git repo.");
      } else {
        console.log(`Repos (${repos.length}):`);
        for (const repo of repos) {
          console.log(`  ${repo.name.padEnd(20)} ${repo.path}`);
        }
      }
    } catch (e: any) {
      console.error(`Failed to reach daemon: ${e.message}`);
    }
  },
});
