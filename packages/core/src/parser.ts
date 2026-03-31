import { appendFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { DecisionEntrySchema, HeartbeatSchema, StepOutputSchema } from "./schemas.ts";
import type { DecisionEntry, HeartbeatData, StepInput, StepOutput, TaskEntry } from "./types.ts";

// Atomic write helper (used by all writes that may be read concurrently)
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, path);
}

// ── Task parsing ──────────────────────────────────────────────────────────────

const TASK_LINE_RE = /^- \[([ x?])\] (.+)$/;

function parseTaskLine(line: string, lineNum: number): TaskEntry {
  const match = line.match(TASK_LINE_RE);
  if (!match) {
    throw new Error(`Invalid task line ${lineNum}: ${line}`);
  }

  const checkbox = match[1] as string;
  const rest = match[2] as string;
  const segments = rest.split("|").map((s) => s.trim());
  const title = segments[0] as string;

  const meta: Record<string, string> = {};
  for (const seg of segments.slice(1)) {
    const colonIdx = seg.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`Invalid metadata segment at line ${lineNum}: "${seg}"`);
    }
    const key = seg.slice(0, colonIdx).trim();
    const val = seg.slice(colonIdx + 1).trim();
    meta[key] = val;
  }

  // Resolve status: explicit metadata takes priority, then fall back to checkbox
  const checkboxStatus =
    checkbox === "x" ? "completed" : checkbox === "?" ? "needs_input" : "queued";
  const status = (meta.status ?? checkboxStatus) as TaskEntry["status"];

  return {
    id: title.replace(/\s+/g, "-").toLowerCase(),
    title,
    status,
    track: meta.track === "-" || !meta.track ? null : meta.track,
    spec_path: meta.spec === "-" || !meta.spec ? null : meta.spec,
    source: (meta.source ?? "cli") as TaskEntry["source"],
    depends_on:
      meta.depends === "-" || !meta.depends ? [] : meta.depends.split(",").map((s) => s.trim()),
    created_at: meta.created_at ?? new Date().toISOString(),
  };
}

function serializeTask(task: TaskEntry): string {
  const checkbox = task.status === "completed" ? "x" : task.status === "needs_input" ? "?" : " ";
  const spec = task.spec_path ?? "-";
  const track = task.track ?? "-";
  const depends = task.depends_on.length > 0 ? task.depends_on.join(",") : "-";
  // Persist status explicitly when the checkbox can't represent it (in_progress, stalled, failed)
  const needsExplicitStatus = !["queued", "completed", "needs_input"].includes(task.status);
  const statusPart = needsExplicitStatus ? ` | status:${task.status}` : "";
  return `- [${checkbox}] ${task.title} | spec:${spec} | source:${task.source} | track:${track} | depends:${depends}${statusPart}`;
}

export async function readTasks(afkDir: string): Promise<TaskEntry[]> {
  const path = join(afkDir, "tasks.md");
  const file = Bun.file(path);
  if (!(await file.exists())) return [];

  const content = await file.text();
  const lines = content.split("\n");
  const tasks: TaskEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (line?.startsWith("- [")) {
      tasks.push(parseTaskLine(line, i + 1));
    }
  }

  return tasks;
}

export async function writeTasks(afkDir: string, tasks: TaskEntry[]): Promise<void> {
  const queued = tasks.filter(
    (t) =>
      t.status === "queued" ||
      t.status === "in_progress" ||
      t.status === "stalled" ||
      t.status === "failed",
  );
  const done = tasks.filter((t) => t.status === "completed");
  const needsInput = tasks.filter((t) => t.status === "needs_input");

  const lines = ["# Tasks", ""];
  if (queued.length > 0) {
    lines.push("## Queue");
    for (const t of queued) lines.push(serializeTask(t));
    lines.push("");
  }
  if (done.length > 0) {
    lines.push("## Done");
    for (const t of done) lines.push(serializeTask(t));
    lines.push("");
  }
  if (needsInput.length > 0) {
    lines.push("## Needs Input");
    for (const t of needsInput) lines.push(serializeTask(t));
    lines.push("");
  }

  await atomicWrite(join(afkDir, "tasks.md"), lines.join("\n"));
}

export async function readSpec(afkDir: string, taskId: string): Promise<string> {
  const path = join(afkDir, "context", "specs", `${taskId}.md`);
  return await Bun.file(path).text();
}

export async function appendDecision(trackDir: string, entry: DecisionEntry): Promise<void> {
  const parsed = DecisionEntrySchema.parse(entry);
  const path = join(trackDir, "decisions.jsonl");
  await appendFile(path, `${JSON.stringify(parsed)}\n`);
}

export async function readHeartbeat(trackDir: string): Promise<HeartbeatData> {
  const path = join(trackDir, "heartbeat.json");
  const raw = await Bun.file(path).json();
  return HeartbeatSchema.parse(raw);
}

export async function writeHeartbeat(trackDir: string, data: HeartbeatData): Promise<void> {
  await atomicWrite(join(trackDir, "heartbeat.json"), JSON.stringify(data, null, 2));
}

export async function writeStepInput(trackDir: string, input: StepInput): Promise<void> {
  await atomicWrite(join(trackDir, "step-input.json"), JSON.stringify(input, null, 2));
}

export async function readStepOutput(trackDir: string): Promise<StepOutput> {
  const path = join(trackDir, "step_complete.json");
  const raw = await Bun.file(path).json();
  return StepOutputSchema.parse(raw);
}
