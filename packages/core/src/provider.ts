import type { ModelTier, ProviderConfig, ProviderInvocation, ProviderName } from "./types.ts";

// ── Invocation Params ────────────────────────────────────────────────────────

export interface InvocationParams {
  prompt: string;
  systemPrompt?: string;
  model: string;
  outputFormat: "json" | "stream-json";
  maxTurns?: number; // Copilot only (--max-autopilot-continues)
  resumeSessionId?: string;
  additionalDirs?: string[];
  dangerousAutoApprove: boolean;
  cwd: string;
}

// ── Model Catalog ────────────────────────────────────────────────────────────

export const DEFAULT_CATALOG: Record<ProviderName, Record<ModelTier, string>> = {
  claude: { frontier: "claude-opus-4-6", standard: "claude-sonnet-4-6", fast: "claude-haiku-4-5" },
  codex: { frontier: "gpt-5.4", standard: "gpt-5.4-mini", fast: "gpt-5.1-codex-mini" },
  gemini: { frontier: "gemini-2.5-pro", standard: "gemini-2.5-flash", fast: "gemini-2.5-flash-lite" },
  copilot: { frontier: "claude-opus-4-6", standard: "claude-sonnet-4-6", fast: "gpt-4.1" },
};

// ── Flag Builders ────────────────────────────────────────────────────────────

/** Merge system prompt into user prompt for providers that lack --append-system-prompt */
function mergePrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `${systemPrompt}\n\n${prompt}`;
}

export function buildClaudeInvocation(params: InvocationParams): ProviderInvocation {
  const args: string[] = ["-p", params.prompt, "--output-format", params.outputFormat, "--model", params.model];

  // Claude requires --verbose when using stream-json with --print
  if (params.outputFormat === "stream-json") {
    args.push("--verbose");
  }

  if (params.systemPrompt) {
    args.push("--append-system-prompt", params.systemPrompt);
  }
  if (params.dangerousAutoApprove) {
    args.push("--dangerously-skip-permissions");
  }
  if (params.resumeSessionId) {
    args.push("--resume", params.resumeSessionId);
  }
  if (params.additionalDirs) {
    for (const dir of params.additionalDirs) {
      args.push("--add-dir", dir);
    }
  }

  return { binary: "claude", args, cwd: params.cwd, env: {}, outputFormat: params.outputFormat };
}

export function buildCodexInvocation(params: InvocationParams): ProviderInvocation {
  const prompt = mergePrompt(params.prompt, params.systemPrompt);

  // Codex uses "exec" subcommand for non-interactive mode
  const args: string[] = ["exec", prompt, "--json", "-m", params.model];

  if (params.dangerousAutoApprove) {
    args.push("--full-auto");
  }
  // Codex uses -C for working directory
  args.push("-C", params.cwd);

  if (params.additionalDirs) {
    for (const dir of params.additionalDirs) {
      args.push("--add-dir", dir);
    }
  }

  // Codex only supports JSONL output (--json), map both formats to it
  return { binary: "codex", args, cwd: params.cwd, env: {}, outputFormat: "stream-json" };
}

export function buildGeminiInvocation(params: InvocationParams): ProviderInvocation {
  const prompt = mergePrompt(params.prompt, params.systemPrompt);

  const args: string[] = ["-p", prompt, "-o", params.outputFormat, "-m", params.model];

  if (params.dangerousAutoApprove) {
    args.push("-y");
  }
  if (params.resumeSessionId) {
    args.push("--resume", params.resumeSessionId);
  }
  if (params.additionalDirs) {
    args.push("--include-directories", params.additionalDirs.join(","));
  }

  return { binary: "gemini", args, cwd: params.cwd, env: {}, outputFormat: params.outputFormat };
}

export function buildCopilotInvocation(params: InvocationParams): ProviderInvocation {
  const prompt = mergePrompt(params.prompt, params.systemPrompt);

  const args: string[] = ["-p", prompt, "--output-format", "json", "--model", params.model];

  if (params.dangerousAutoApprove) {
    args.push("--yolo");
  }
  args.push("--autopilot");
  args.push("--no-ask-user");

  if (params.maxTurns !== undefined) {
    args.push("--max-autopilot-continues", String(params.maxTurns));
  }
  if (params.resumeSessionId) {
    args.push(`--resume=${params.resumeSessionId}`);
  }
  if (params.additionalDirs) {
    for (const dir of params.additionalDirs) {
      args.push("--add-dir", dir);
    }
  }

  // Copilot outputs JSONL (newline-delimited JSON events)
  return { binary: "copilot", args, cwd: params.cwd, env: {}, outputFormat: "stream-json" };
}

const FLAG_BUILDERS: Record<ProviderName, (params: InvocationParams) => ProviderInvocation> = {
  claude: buildClaudeInvocation,
  codex: buildCodexInvocation,
  gemini: buildGeminiInvocation,
  copilot: buildCopilotInvocation,
};

export function buildInvocation(provider: ProviderName, params: InvocationParams): ProviderInvocation {
  return FLAG_BUILDERS[provider](params);
}

// ── Provider Detection ───────────────────────────────────────────────────────

const KNOWN_PROVIDERS: { name: ProviderName; binary: string }[] = [
  { name: "claude", binary: "claude" },
  { name: "codex", binary: "codex" },
  { name: "gemini", binary: "gemini" },
  { name: "copilot", binary: "copilot" },
];

async function detectOne(binary: string): Promise<{ available: boolean; version?: string }> {
  try {
    const which = Bun.spawn(["which", binary], { stdout: "pipe", stderr: "pipe" });
    const whichExit = await which.exited;
    if (whichExit !== 0) return { available: false };

    // Try --version with a timeout
    const ver = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => ver.kill(), 5_000);
    const verExit = await ver.exited;
    clearTimeout(timeout);

    if (verExit === 0) {
      const version = (await new Response(ver.stdout).text()).trim();
      return { available: true, version };
    }
    // Binary exists but --version failed — still available
    return { available: true };
  } catch {
    return { available: false };
  }
}

export async function detectProviders(): Promise<Map<ProviderName, ProviderConfig>> {
  const results = await Promise.all(
    KNOWN_PROVIDERS.map(async ({ name, binary }) => {
      const { available, version } = await detectOne(binary);
      return { name, config: { binary, available, version } as ProviderConfig };
    }),
  );

  const map = new Map<ProviderName, ProviderConfig>();
  for (const { name, config } of results) {
    map.set(name, config);
  }
  return map;
}

// ── Tier Resolution ──────────────────────────────────────────────────────────

export interface ResolvedModel {
  provider: ProviderName;
  model: string;
}

export function resolveModel(
  tier: ModelTier,
  preferredProviders: ProviderName[],
  availableProviders: Set<ProviderName>,
  catalog: Record<ProviderName, Record<ModelTier, string>> = DEFAULT_CATALOG,
): ResolvedModel | null {
  for (const provider of preferredProviders) {
    if (!availableProviders.has(provider)) continue;
    const model = catalog[provider]?.[tier];
    if (model) return { provider, model };
  }
  return null;
}
