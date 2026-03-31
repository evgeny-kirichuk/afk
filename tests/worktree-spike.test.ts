import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorktree,
  listWorktrees,
  normalizePath,
  parseWorktreeList,
  reconcileWorktrees,
  removeWorktree,
  unlockWorktree,
} from "../spike/worktree-spike.ts";

// ── Test repo fixture ─────────────────────────────────────────────────────────

let tmpBase: string;
let repoPath: string;

async function initRepo(base: string): Promise<string> {
  const repo = join(base, "repo");
  await Bun.$`git init ${repo}`.quiet();
  await Bun.$`git -C ${repo} config user.email "test@afk"`.quiet();
  await Bun.$`git -C ${repo} config user.name "AFK Test"`.quiet();
  await Bun.$`touch ${join(repo, "README.md")}`.quiet();
  await Bun.$`git -C ${repo} add .`.quiet();
  await Bun.$`git -C ${repo} commit -m "init"`.quiet();
  return repo;
}

beforeEach(async () => {
  tmpBase = await mkdtemp(join(tmpdir(), "afk-worktree-test-"));
  repoPath = await initRepo(tmpBase);
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function worktreePath(name: string): string {
  return join(tmpBase, "worktrees", name);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parseWorktreeList", () => {
  test("parses porcelain output into records", () => {
    const raw = `worktree /repo
HEAD abc123
branch refs/heads/main

worktree /repo/wt-1
HEAD def456
branch refs/heads/feature/x

`;
    const records = parseWorktreeList(raw);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ path: "/repo", head: "abc123", branch: "main" });
    expect(records[1]).toEqual({ path: "/repo/wt-1", head: "def456", branch: "feature/x" });
  });

  test("returns empty array for empty input", () => {
    expect(parseWorktreeList("")).toHaveLength(0);
    expect(parseWorktreeList("\n")).toHaveLength(0);
  });
});

describe("createWorktree + listWorktrees", () => {
  test("new worktree appears in list with correct branch", async () => {
    const wt = worktreePath("task-1");
    await createWorktree(repoPath, wt, "afk/task-1");

    const list = await listWorktrees(repoPath);
    const paths = list.map((w) => w.path);
    const resolvedWt = await normalizePath(wt);
    expect(paths).toContain(resolvedWt);

    const record = list.find((w) => w.path === resolvedWt);
    expect(record?.branch).toBe("afk/task-1");
  });

  test("main worktree is always listed first", async () => {
    const wt = worktreePath("task-2");
    await createWorktree(repoPath, wt, "afk/task-2");

    const list = await listWorktrees(repoPath);
    const resolvedRepo = await normalizePath(repoPath);
    expect(list[0].path).toBe(resolvedRepo);
  });
});

describe("removeWorktree", () => {
  test("worktree disappears from list after clean removal", async () => {
    const wt = worktreePath("task-rm");
    await createWorktree(repoPath, wt, "afk/task-rm");
    await removeWorktree(repoPath, wt);

    const list = await listWorktrees(repoPath);
    const resolvedWt = await realpath(repoPath); // only main remains
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe(resolvedWt);
  });
});

describe("reconcileWorktrees — orphan detection", () => {
  test("no orphans when worktree directory still exists", async () => {
    const wt = worktreePath("task-ok");
    await createWorktree(repoPath, wt, "afk/task-ok");
    const resolvedWt = await normalizePath(wt);

    const { orphaned, pruned } = await reconcileWorktrees(repoPath, [
      { path: resolvedWt, branch: "afk/task-ok", head: "" },
    ]);

    expect(orphaned).toHaveLength(0);
    expect(pruned).toBe(true);
  });

  test("detects orphan when directory is deleted (simulates crash)", async () => {
    const wt = worktreePath("task-crash");
    await createWorktree(repoPath, wt, "afk/task-crash");
    const resolvedWt = await normalizePath(wt);

    // Simulate crash: directory disappears but git worktree remove was never called
    await rm(wt, { recursive: true, force: true });

    const { orphaned, pruned } = await reconcileWorktrees(repoPath, [
      { path: resolvedWt, branch: "afk/task-crash", head: "" },
    ]);

    expect(orphaned).toContain(resolvedWt);
    expect(pruned).toBe(true);

    // After reconcile, git's metadata should be cleaned up too
    const list = await listWorktrees(repoPath);
    expect(list.map((w) => w.path)).not.toContain(resolvedWt);
  });

  test("handles multiple tracked worktrees — only orphans are flagged", async () => {
    const wt1 = worktreePath("task-alive");
    const wt2 = worktreePath("task-dead");
    await createWorktree(repoPath, wt1, "afk/task-alive");
    await createWorktree(repoPath, wt2, "afk/task-dead");
    const resolvedWt1 = await normalizePath(wt1);
    const resolvedWt2 = await normalizePath(wt2);

    await rm(wt2, { recursive: true, force: true }); // only wt2 "crashed"

    const { orphaned } = await reconcileWorktrees(repoPath, [
      { path: resolvedWt1, branch: "afk/task-alive", head: "" },
      { path: resolvedWt2, branch: "afk/task-dead", head: "" },
    ]);

    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toBe(resolvedWt2);
  });
});

describe("unlockWorktree — lock file handling", () => {
  test("removes lock file and returns true", async () => {
    const wt = worktreePath("task-locked");
    await createWorktree(repoPath, wt, "afk/task-locked");

    // Git names the worktree metadata dir after the worktree directory name
    const wtName = "task-locked";
    const lockPath = join(repoPath, ".git", "worktrees", wtName, "locked");
    await writeFile(lockPath, "test lock");

    const unlocked = await unlockWorktree(repoPath, wtName);
    expect(unlocked).toBe(true);

    // Lock file should be gone
    expect(await Bun.file(lockPath).exists()).toBe(false);
  });

  test("returns false when no lock file exists", async () => {
    const wt = worktreePath("task-unlocked");
    await createWorktree(repoPath, wt, "afk/task-unlocked");

    const unlocked = await unlockWorktree(repoPath, "task-unlocked");
    expect(unlocked).toBe(false);
  });
});
