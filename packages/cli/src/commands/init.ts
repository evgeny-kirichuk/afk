import { basename, resolve } from "node:path";
import { defineCommand } from "citty";
import { DaemonClient } from "../client.ts";

export default defineCommand({
  meta: { name: "init", description: "Register this repo with AFK" },
  args: {
    name: { type: "string", description: "Repo alias (defaults to directory name)" },
  },
  async run({ args }) {
    const info = DaemonClient.requireRunning();

    const repoPath = resolve(process.cwd());
    const name = args.name ?? basename(repoPath);

    // Verify this is a git repo
    const gitCheck = Bun.spawn(["git", "rev-parse", "--git-dir"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if ((await gitCheck.exited) !== 0) {
      console.error(`Not a git repository: ${repoPath}`);
      process.exit(1);
    }

    const client = new DaemonClient(info.port);
    try {
      const { repo, created } = await client.registerRepo(name, repoPath);
      if (created) {
        console.log(`Registered repo "${repo.name}" at ${repo.path}`);
      } else {
        console.log(`Repo already registered: "${repo.name}" at ${repo.path}`);
      }
    } catch (e: any) {
      console.error(`Failed to register repo: ${e.message}`);
      process.exit(1);
    }
  },
});
