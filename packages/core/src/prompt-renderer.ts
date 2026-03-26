import type { ModelTier, ProviderName } from "./types.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TemplateFrontmatter {
  requires: string[];
  tier: ModelTier;
  [key: string]: unknown;
}

export interface ParsedTemplate {
  frontmatter: TemplateFrontmatter;
  body: string;
}

export interface RenderResult {
  systemPrompt: string | null; // non-null only for Claude
  userPrompt: string;
}

// ── Frontmatter Parser ───────────────────────────────────────────────────────

/** Minimal YAML-like parser for simple frontmatter (flat scalars + one-level arrays) */
function parseFrontmatter(raw: string): TemplateFrontmatter {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");

  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array item: "  - value"
    const arrayMatch = trimmed.match(/^-\s+(.+)$/);
    if (arrayMatch && currentKey && currentArray) {
      currentArray.push(arrayMatch[1]!.trim());
      continue;
    }

    // Flush any pending array
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key-value: "key: value" or "key:"
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1]!;
      const value = kvMatch[2]!.trim();
      if (value === "" || value === "[]") {
        // Might be followed by array items
        currentKey = key;
        currentArray = [];
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array: [item1, item2]
        result[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        result[key] = value;
      }
    }
  }

  // Flush final array
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return {
    requires: Array.isArray(result.requires) ? (result.requires as string[]) : [],
    tier: (result.tier as ModelTier) ?? "standard",
    ...result,
  };
}

// ── Template Parser ──────────────────────────────────────────────────────────

export function parseTemplate(raw: string): ParsedTemplate {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = raw.match(fmRegex);

  if (!match) {
    // No frontmatter — treat entire content as body
    return {
      frontmatter: { requires: [], tier: "standard" },
      body: raw,
    };
  }

  return {
    frontmatter: parseFrontmatter(match[1]!),
    body: match[2]!,
  };
}

// ── Prompt Renderer ──────────────────────────────────────────────────────────

export function renderStepPrompt(
  template: ParsedTemplate,
  context: Record<string, string>,
  provider: ProviderName,
): RenderResult {
  // Validate required context keys
  for (const key of template.frontmatter.requires) {
    if (!(key in context)) {
      throw new Error(`Missing required context key: "${key}" (required by template)`);
    }
  }

  // Replace {{placeholders}}
  const rendered = template.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return context[key] ?? "";
  });

  // Claude gets a separate system prompt; others get it embedded in user prompt
  if (provider === "claude") {
    return {
      systemPrompt: rendered,
      userPrompt: context.task_content ?? "",
    };
  }

  // For non-Claude: combine rendered template + task content
  const taskContent = context.task_content ?? "";
  const userPrompt = taskContent ? `${rendered}\n\n${taskContent}` : rendered;

  return {
    systemPrompt: null,
    userPrompt,
  };
}
