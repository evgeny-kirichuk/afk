import { join } from "node:path";
import { execute, type StreamEvent } from "./executor.ts";
import { parseTemplate, renderStepPrompt } from "./prompt-renderer.ts";
import { buildInvocation, type InvocationParams } from "./provider.ts";
import { StepOutputSchema } from "./schemas.ts";
import type { SessionStore } from "./session-store.ts";
import type { ProviderName, ReviewFinding, StepName, StepOutput } from "./types.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StepRunnerInput {
  step: StepName;
  taskId: string;
  trackId: string;
  afkDir: string;
  worktreeDir: string;
  provider: ProviderName;
  model: string;
  sessionStore: SessionStore;
  parentSessionId?: string;
  resumeProviderSessionId?: string;
  reviewContext?: ReviewFinding[];
  onEvent?: (event: StreamEvent) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  dangerousAutoApprove?: boolean;
  /** Override the binary path (for testing with fake agents) */
  binaryOverride?: string;
}

export interface StepRunnerResult {
  sessionId: string;
  output: StepOutput;
  providerSessionId: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readFileIfExists(path: string): Promise<string | null> {
  const file = Bun.file(path);
  if (await file.exists()) return await file.text();
  return null;
}

// ── Step Runner ──────────────────────────────────────────────────────────────

export async function runStep(input: StepRunnerInput): Promise<StepRunnerResult> {
  const {
    step,
    taskId,
    trackId,
    afkDir,
    worktreeDir,
    provider,
    model,
    sessionStore,
    parentSessionId,
    resumeProviderSessionId,
    reviewContext,
    onEvent,
    timeoutMs,
    signal,
    dangerousAutoApprove = true,
    binaryOverride,
  } = input;

  // 1. Create session
  const sessionId = crypto.randomUUID();
  sessionStore.createSession({
    id: sessionId,
    track_id: trackId,
    task_id: taskId,
    step,
    provider,
    model,
    parent_session_id: parentSessionId,
  });

  // 2. Read step template
  const templatePath = join(afkDir, "context", "steps", `${step}.md`);
  const templateRaw = await readFileIfExists(templatePath);
  if (!templateRaw) {
    throw new Error(`Step template not found: ${templatePath}`);
  }
  const template = parseTemplate(templateRaw);

  // 3. Read task spec
  const specPath = join(afkDir, "context", "specs", `${taskId}.md`);
  const spec = await readFileIfExists(specPath);
  if (!spec) {
    throw new Error(`Task spec not found: ${specPath}`);
  }

  // 4. Assemble context
  const context: Record<string, string> = {
    spec,
    task_id: taskId,
    track_id: trackId,
    task_content: spec,
  };

  const memory = await readFileIfExists(join(afkDir, "MEMORY.md"));
  if (memory) context.memory = memory;

  const activeContext = await readFileIfExists(join(afkDir, "context", "active-context.md"));
  if (activeContext) context.active_context = activeContext;

  // Read previous step output if exists
  const prevOutput = await readFileIfExists(join(afkDir, "tracks", trackId, "step-output.json"));
  if (prevOutput) context.previous_step_output = prevOutput;

  // Review context
  if (reviewContext && reviewContext.length > 0) {
    context.review_context = JSON.stringify(reviewContext, null, 2);
  }

  // 5. Render prompt
  const { systemPrompt, userPrompt } = renderStepPrompt(template, context, provider);

  // 6. Build invocation
  const invocationParams: InvocationParams = {
    prompt: userPrompt,
    systemPrompt: systemPrompt ?? undefined,
    model,
    outputFormat: "json",
    resumeSessionId: resumeProviderSessionId,
    dangerousAutoApprove,
    cwd: worktreeDir,
  };
  const invocation = buildInvocation(provider, invocationParams);
  if (binaryOverride) {
    invocation.binary = binaryOverride;
  }

  // 7. Execute
  const result = await execute({
    invocation,
    sessionStore,
    sessionId,
    provider,
    onEvent,
    timeoutMs,
    signal,
  });

  // 8. Read step_complete.json from track directory
  const trackDir = join(afkDir, "tracks", trackId);
  const completePath = join(trackDir, "step_complete.json");
  let output: StepOutput;

  const completeRaw = await readFileIfExists(completePath);
  if (completeRaw) {
    try {
      const parsed = JSON.parse(completeRaw);
      output = StepOutputSchema.parse(parsed) as unknown as StepOutput;
    } catch (err) {
      // Invalid step_complete.json — construct failed output
      output = {
        step,
        task_id: taskId,
        status: "failed",
        summary: `step_complete.json validation failed: ${err instanceof Error ? err.message : String(err)}`,
        decisions: [],
        error: "invalid_step_output",
      };
    }
  } else if (result.exitCode === 0) {
    // No step_complete.json but process succeeded — construct minimal output
    output = {
      step,
      task_id: taskId,
      status: "completed",
      summary: "Step completed (no step_complete.json written by agent)",
      decisions: [],
    };
  } else {
    // Process failed and no step_complete.json
    output = {
      step,
      task_id: taskId,
      status: "failed",
      summary: result.stderr.slice(0, 500) || "Step failed with no output",
      decisions: [],
      error: `exit_code_${result.exitCode}`,
    };
  }

  // 9. Update session with final status
  sessionStore.updateSession(sessionId, {
    status: output.status === "completed" ? "completed" : "failed",
  });

  return {
    sessionId,
    output,
    providerSessionId: result.providerSessionId,
  };
}
