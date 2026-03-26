import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CATALOG,
  buildClaudeInvocation,
  buildCodexInvocation,
  buildCopilotInvocation,
  buildGeminiInvocation,
  buildInvocation,
  resolveModel,
  type InvocationParams,
  type ModelTier,
  type ProviderName,
} from "@afk/core";

const BASE_PARAMS: InvocationParams = {
  prompt: "Write hello world",
  model: "test-model",
  outputFormat: "json",
  dangerousAutoApprove: true,
  cwd: "/tmp/test",
};

// ── Claude ───────────────────────────────────────────────────────────────────

describe("buildClaudeInvocation", () => {
  test("basic invocation", () => {
    const inv = buildClaudeInvocation(BASE_PARAMS);
    expect(inv.binary).toBe("claude");
    expect(inv.args).toContain("-p");
    expect(inv.args).toContain("Write hello world");
    expect(inv.args).toContain("--output-format");
    expect(inv.args).toContain("json");
    expect(inv.args).toContain("--model");
    expect(inv.args).toContain("test-model");
    expect(inv.args).toContain("--dangerously-skip-permissions");
  });

  test("includes --append-system-prompt for Claude", () => {
    const inv = buildClaudeInvocation({ ...BASE_PARAMS, systemPrompt: "You are a helpful agent." });
    expect(inv.args).toContain("--append-system-prompt");
    expect(inv.args).toContain("You are a helpful agent.");
    // System prompt should NOT be merged into the user prompt
    expect(inv.args[inv.args.indexOf("-p") + 1]).toBe("Write hello world");
  });

  test("resume session", () => {
    const inv = buildClaudeInvocation({ ...BASE_PARAMS, resumeSessionId: "abc-123" });
    expect(inv.args).toContain("--resume");
    expect(inv.args).toContain("abc-123");
  });

  test("additional dirs", () => {
    const inv = buildClaudeInvocation({ ...BASE_PARAMS, additionalDirs: ["/a", "/b"] });
    const addDirIndices = inv.args.reduce<number[]>((acc, a, i) => (a === "--add-dir" ? [...acc, i] : acc), []);
    expect(addDirIndices).toHaveLength(2);
    expect(inv.args[addDirIndices[0]! + 1]).toBe("/a");
    expect(inv.args[addDirIndices[1]! + 1]).toBe("/b");
  });

  test("stream-json output format", () => {
    const inv = buildClaudeInvocation({ ...BASE_PARAMS, outputFormat: "stream-json" });
    expect(inv.outputFormat).toBe("stream-json");
    expect(inv.args).toContain("stream-json");
  });

  test("no auto-approve when disabled", () => {
    const inv = buildClaudeInvocation({ ...BASE_PARAMS, dangerousAutoApprove: false });
    expect(inv.args).not.toContain("--dangerously-skip-permissions");
  });
});

// ── Codex ────────────────────────────────────────────────────────────────────

describe("buildCodexInvocation", () => {
  test("uses exec subcommand", () => {
    const inv = buildCodexInvocation(BASE_PARAMS);
    expect(inv.binary).toBe("codex");
    expect(inv.args[0]).toBe("exec");
    expect(inv.args).toContain("--json");
    expect(inv.args).toContain("-m");
    expect(inv.args).toContain("test-model");
    expect(inv.args).toContain("--full-auto");
  });

  test("embeds system prompt in user prompt", () => {
    const inv = buildCodexInvocation({ ...BASE_PARAMS, systemPrompt: "Step instructions here." });
    const promptIdx = inv.args.indexOf("exec") + 1;
    expect(inv.args[promptIdx]).toContain("Step instructions here.");
    expect(inv.args[promptIdx]).toContain("Write hello world");
    // No --append-system-prompt flag
    expect(inv.args).not.toContain("--append-system-prompt");
  });

  test("uses -C for working directory", () => {
    const inv = buildCodexInvocation(BASE_PARAMS);
    expect(inv.args).toContain("-C");
    expect(inv.args).toContain("/tmp/test");
  });

  test("always outputs stream-json", () => {
    const inv = buildCodexInvocation({ ...BASE_PARAMS, outputFormat: "json" });
    expect(inv.outputFormat).toBe("stream-json");
  });
});

// ── Gemini ───────────────────────────────────────────────────────────────────

describe("buildGeminiInvocation", () => {
  test("basic invocation", () => {
    const inv = buildGeminiInvocation(BASE_PARAMS);
    expect(inv.binary).toBe("gemini");
    expect(inv.args).toContain("-p");
    expect(inv.args).toContain("-o");
    expect(inv.args).toContain("json");
    expect(inv.args).toContain("-m");
    expect(inv.args).toContain("test-model");
    expect(inv.args).toContain("-y");
  });

  test("embeds system prompt in user prompt", () => {
    const inv = buildGeminiInvocation({ ...BASE_PARAMS, systemPrompt: "Step instructions." });
    const promptIdx = inv.args.indexOf("-p") + 1;
    expect(inv.args[promptIdx]).toContain("Step instructions.");
    expect(inv.args[promptIdx]).toContain("Write hello world");
  });

  test("additional dirs use --include-directories with comma-separated list", () => {
    const inv = buildGeminiInvocation({ ...BASE_PARAMS, additionalDirs: ["/a", "/b"] });
    expect(inv.args).toContain("--include-directories");
    expect(inv.args).toContain("/a,/b");
  });

  test("resume session", () => {
    const inv = buildGeminiInvocation({ ...BASE_PARAMS, resumeSessionId: "latest" });
    expect(inv.args).toContain("--resume");
    expect(inv.args).toContain("latest");
  });
});

// ── Copilot ──────────────────────────────────────────────────────────────────

describe("buildCopilotInvocation", () => {
  test("basic invocation", () => {
    const inv = buildCopilotInvocation(BASE_PARAMS);
    expect(inv.binary).toBe("copilot");
    expect(inv.args).toContain("-p");
    expect(inv.args).toContain("--output-format");
    expect(inv.args).toContain("json");
    expect(inv.args).toContain("--model");
    expect(inv.args).toContain("test-model");
    expect(inv.args).toContain("--yolo");
    expect(inv.args).toContain("--autopilot");
    expect(inv.args).toContain("--no-ask-user");
  });

  test("embeds system prompt in user prompt", () => {
    const inv = buildCopilotInvocation({ ...BASE_PARAMS, systemPrompt: "Step instructions." });
    const promptIdx = inv.args.indexOf("-p") + 1;
    expect(inv.args[promptIdx]).toContain("Step instructions.");
    expect(inv.args[promptIdx]).toContain("Write hello world");
  });

  test("max turns", () => {
    const inv = buildCopilotInvocation({ ...BASE_PARAMS, maxTurns: 10 });
    expect(inv.args).toContain("--max-autopilot-continues");
    expect(inv.args).toContain("10");
  });

  test("resume uses = syntax", () => {
    const inv = buildCopilotInvocation({ ...BASE_PARAMS, resumeSessionId: "sess-42" });
    expect(inv.args).toContain("--resume=sess-42");
  });
});

// ── buildInvocation dispatcher ───────────────────────────────────────────────

describe("buildInvocation", () => {
  test("dispatches to correct builder", () => {
    const providers: ProviderName[] = ["claude", "codex", "gemini", "copilot"];
    for (const p of providers) {
      const inv = buildInvocation(p, BASE_PARAMS);
      expect(inv.binary).toBe(p);
    }
  });
});

// ── Model Catalog ────────────────────────────────────────────────────────────

describe("DEFAULT_CATALOG", () => {
  test("every provider × tier has a value", () => {
    const providers: ProviderName[] = ["claude", "codex", "gemini", "copilot"];
    const tiers: ModelTier[] = ["frontier", "standard", "fast"];
    for (const p of providers) {
      for (const t of tiers) {
        expect(DEFAULT_CATALOG[p][t]).toBeTruthy();
      }
    }
  });
});

// ── Tier Resolution ──────────────────────────────────────────────────────────

describe("resolveModel", () => {
  test("returns first available provider", () => {
    const available = new Set<ProviderName>(["gemini", "copilot"]);
    const result = resolveModel("standard", ["claude", "gemini", "copilot"], available);
    expect(result).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
  });

  test("returns null when no provider available", () => {
    const available = new Set<ProviderName>([]);
    const result = resolveModel("frontier", ["claude", "codex"], available);
    expect(result).toBeNull();
  });

  test("respects preference order", () => {
    const available = new Set<ProviderName>(["claude", "codex"]);
    const result = resolveModel("fast", ["codex", "claude"], available);
    expect(result?.provider).toBe("codex");
  });

  test("uses custom catalog", () => {
    const catalog = {
      claude: { frontier: "custom-model", standard: "x", fast: "y" },
      codex: { frontier: "x", standard: "x", fast: "x" },
      gemini: { frontier: "x", standard: "x", fast: "x" },
      copilot: { frontier: "x", standard: "x", fast: "x" },
    };
    const result = resolveModel("frontier", ["claude"], new Set<ProviderName>(["claude"]), catalog);
    expect(result?.model).toBe("custom-model");
  });
});
