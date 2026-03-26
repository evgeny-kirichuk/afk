import { describe, expect, test } from "bun:test";
import { parseTemplate, renderStepPrompt } from "@afk/core";

const SAMPLE_TEMPLATE = `---
requires:
  - spec
  - memory
tier: frontier
---
# Implement

You are implementing a coding task.

## Spec
{{spec}}

## Memory
{{memory}}

## Previous Output
{{previous_step_output}}
`;

// ── parseTemplate ────────────────────────────────────────────────────────────

describe("parseTemplate", () => {
  test("parses frontmatter and body", () => {
    const parsed = parseTemplate(SAMPLE_TEMPLATE);
    expect(parsed.frontmatter.requires).toEqual(["spec", "memory"]);
    expect(parsed.frontmatter.tier).toBe("frontier");
    expect(parsed.body).toContain("# Implement");
    expect(parsed.body).toContain("{{spec}}");
  });

  test("handles inline array syntax", () => {
    const raw = `---
requires: [spec, memory, context]
tier: fast
---
Body here`;
    const parsed = parseTemplate(raw);
    expect(parsed.frontmatter.requires).toEqual(["spec", "memory", "context"]);
    expect(parsed.frontmatter.tier).toBe("fast");
  });

  test("handles no frontmatter", () => {
    const raw = "Just a plain template with {{placeholders}}";
    const parsed = parseTemplate(raw);
    expect(parsed.frontmatter.requires).toEqual([]);
    expect(parsed.frontmatter.tier).toBe("standard");
    expect(parsed.body).toBe(raw);
  });

  test("handles empty requires", () => {
    const raw = `---
requires: []
tier: standard
---
Body`;
    const parsed = parseTemplate(raw);
    expect(parsed.frontmatter.requires).toEqual([]);
  });
});

// ── renderStepPrompt ─────────────────────────────────────────────────────────

describe("renderStepPrompt", () => {
  const template = parseTemplate(SAMPLE_TEMPLATE);
  const context = {
    spec: "Build a REST API",
    memory: "User prefers TypeScript",
    previous_step_output: "",
    task_content: "Implement the /users endpoint",
  };

  test("Claude: systemPrompt populated, userPrompt is task content", () => {
    const result = renderStepPrompt(template, context, "claude");
    expect(result.systemPrompt).not.toBeNull();
    expect(result.systemPrompt).toContain("Build a REST API");
    expect(result.systemPrompt).toContain("User prefers TypeScript");
    expect(result.systemPrompt).toContain("# Implement");
    expect(result.userPrompt).toBe("Implement the /users endpoint");
  });

  test("Codex: systemPrompt null, userPrompt has both", () => {
    const result = renderStepPrompt(template, context, "codex");
    expect(result.systemPrompt).toBeNull();
    expect(result.userPrompt).toContain("# Implement");
    expect(result.userPrompt).toContain("Build a REST API");
    expect(result.userPrompt).toContain("Implement the /users endpoint");
  });

  test("Gemini: systemPrompt null, userPrompt has both", () => {
    const result = renderStepPrompt(template, context, "gemini");
    expect(result.systemPrompt).toBeNull();
    expect(result.userPrompt).toContain("# Implement");
    expect(result.userPrompt).toContain("Implement the /users endpoint");
  });

  test("Copilot: systemPrompt null, userPrompt has both", () => {
    const result = renderStepPrompt(template, context, "copilot");
    expect(result.systemPrompt).toBeNull();
    expect(result.userPrompt).toContain("# Implement");
    expect(result.userPrompt).toContain("Implement the /users endpoint");
  });

  test("missing required key throws", () => {
    const incompleteContext = { task_content: "some task" };
    expect(() => renderStepPrompt(template, incompleteContext, "claude")).toThrow(
      'Missing required context key: "spec"',
    );
  });

  test("unknown placeholder left as empty string", () => {
    const templateWithExtra = parseTemplate(`---
requires: []
tier: standard
---
Hello {{name}}, your id is {{unknown_key}}`);

    const result = renderStepPrompt(templateWithExtra, { name: "Alice", task_content: "" }, "codex");
    expect(result.userPrompt).toContain("Hello Alice");
    expect(result.userPrompt).toContain("your id is ");
    // Unknown placeholder replaced with empty string, not left as {{unknown_key}}
  });

  test("placeholders in required list are substituted", () => {
    const result = renderStepPrompt(template, context, "codex");
    expect(result.userPrompt).not.toContain("{{spec}}");
    expect(result.userPrompt).not.toContain("{{memory}}");
  });
});
