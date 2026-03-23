import { loadConfig } from "c12";
import { SessionConfigSchema } from "./schemas.ts";

export async function loadAfkConfig(repoRoot: string) {
  const { config: raw } = await loadConfig({
    name: "afk",
    cwd: repoRoot,
    globalRc: true, // picks up ~/.afk/config.yaml
    dotenv: false, // Bun auto-loads .env
    defaults: {
      session: { tracks: 1, autonomy: "supervised", started_at: null, status: "idle" },
      heartbeat: {},
      loop: {},
      workflow: {},
    },
  });

  const result = SessionConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid afk config:\n${JSON.stringify(result.error.format(), null, 2)}`);
  }
  return result.data;
}
