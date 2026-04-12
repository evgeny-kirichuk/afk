import { join, resolve } from "node:path";
import {
  detectProviders,
  type ProviderName,
  resolveModel,
  runStep,
  SessionStore,
  type StepName,
} from "@afk/core";
import { defineCommand } from "citty";

const VALID_STEPS: StepName[] = [
  "prep",
  "pick",
  "analyze",
  "test_plan",
  "implement",
  "cleanup",
  "simplify",
  "review",
  "distill",
  "validate",
  "commit",
  "explore",
];

export default defineCommand({
  meta: { name: "run-step", description: "Execute a single workflow step" },
  args: {
    step: {
      type: "positional",
      description: "Step to run (implement, review, analyze, etc.)",
      required: true,
    },
    task: {
      type: "string",
      description: "Task ID",
      required: true,
    },
    track: {
      type: "string",
      description: "Track ID",
      default: "track-1",
    },
    worktree: {
      type: "string",
      description: "Working directory for the agent",
      default: ".",
    },
    provider: {
      type: "string",
      description: "Provider to use (claude, codex, gemini, copilot)",
    },
    model: {
      type: "string",
      description: "Model to use (overrides tier resolution)",
    },
    tier: {
      type: "string",
      description: "Model tier (frontier, standard, fast)",
      default: "standard",
    },
    "afk-dir": {
      type: "string",
      description: "Path to afk/ directory",
      default: "./afk",
    },
  },
  async run({ args }) {
    const step = args.step as StepName;
    if (!VALID_STEPS.includes(step)) {
      console.error(`Invalid step: ${step}. Valid steps: ${VALID_STEPS.join(", ")}`);
      process.exit(1);
    }

    const afkDir = resolve(args["afk-dir"]);
    const worktreeDir = resolve(args.worktree);
    const dbPath = join(afkDir, "sessions.db");

    // Detect available providers
    const providers = await detectProviders();

    // Resolve provider and model
    let providerName: ProviderName;
    let modelId: string;

    if (args.provider) {
      providerName = args.provider as ProviderName;
      const config = providers.get(providerName);
      if (!config?.available) {
        console.error(`Provider ${providerName} is not available`);
        process.exit(1);
      }
    } else {
      // Auto-detect: prefer claude
      const available = new Set<ProviderName>();
      for (const [name, config] of providers) {
        if (config.available) available.add(name);
      }
      const resolved = resolveModel(
        args.tier as "frontier" | "standard" | "fast",
        ["claude", "codex", "gemini", "copilot"],
        available,
      );
      if (!resolved) {
        console.error("No providers available. Install claude, codex, gemini, or copilot.");
        process.exit(1);
      }
      providerName = resolved.provider;
      modelId = resolved.model;
    }

    if (args.model) {
      modelId = args.model;
    } else if (!modelId!) {
      const available = new Set<ProviderName>([providerName]);
      const resolved = resolveModel(
        args.tier as "frontier" | "standard" | "fast",
        [providerName],
        available,
      );
      modelId = resolved?.model ?? "default";
    }

    const store = new SessionStore(dbPath);

    console.log(`Running step: ${step}`);
    console.log(`  task: ${args.task}`);
    console.log(`  provider: ${providerName} / ${modelId}`);
    console.log(`  worktree: ${worktreeDir}`);

    try {
      const result = await runStep({
        step,
        taskId: args.task,
        trackId: args.track,
        afkDir,
        worktreeDir,
        provider: providerName,
        model: modelId,
        sessionStore: store,
        onEvent: (event) => {
          if (event.type === "assistant" || event.type === "result") {
            process.stdout.write(".");
          }
        },
      });

      console.log(`\nStep completed: ${result.output.status}`);
      console.log(`  summary: ${result.output.summary}`);
      console.log(`  session: ${result.sessionId}`);
      if (result.providerSessionId) {
        console.log(`  provider session: ${result.providerSessionId}`);
      }
    } catch (err) {
      console.error(`Step failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      store.close();
    }
  },
});
