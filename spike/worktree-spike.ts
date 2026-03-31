/**
 * P0.3 — Git worktree crash recovery spike
 *
 * Demonstrates the full lifecycle: create → track → (crash) → reconcile → cleanup.
 * Run directly:  bun spike/worktree-spike.ts
 *
 * The script is intentionally self-contained — it creates a temp git repo,
 * runs through the scenarios, then cleans up after itself.
 */

import { mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

// ── Worktree record type ──────────────────────────────────────────────────────

export interface WorktreeRecord {
  path: string;
  branch: string | null;
  head: string;
}

// ── Git helpers ───────────────────────────────────────────────────────────────

/** Parse the output of `git worktree list --porcelain` into records. */
export function parseWorktreeList(raw: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: Partial<WorktreeRecord> = { branch: null };

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) records.push(current as WorktreeRecord);
      current = { path: line.slice("worktree ".length).trim(), branch: null };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      // Format: refs/heads/<name>
      current.branch = line.slice("branch ".length).trim().replace("refs/heads/", "");
    } else if (line === "" && current.path) {
      records.push(current as WorktreeRecord);
      current = {};
    }
  }
  if (current.path) records.push(current as WorktreeRecord);

  return records;
}

/** Create a git worktree. Returns the worktree path. */
export async function createWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
  const result = await Bun.$`git -C ${repoPath} worktree add ${worktreePath} -b ${branch}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${result.stderr.toString()}`);
  }
}

/** Remove a worktree cleanly. */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const result = await Bun.$`git -C ${repoPath} worktree remove --force ${worktreePath}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`git worktree remove failed: ${result.stderr.toString()}`);
  }
}

/** List all worktrees for a repo. Paths are symlink-resolved (realpath). */
export async function listWorktrees(repoPath: string): Promise<WorktreeRecord[]> {
  const result = await Bun.$`git -C ${repoPath} worktree list --porcelain`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`git worktree list failed: ${result.stderr.toString()}`);
  }
  return parseWorktreeList(result.stdout.toString());
}

/**
 * Resolve a path to its canonical form so comparisons work correctly on
 * systems where /tmp is a symlink (e.g. macOS: /var → /private/var).
 * If the path no longer exists, returns the original path unchanged.
 */
export async function normalizePath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/**
 * Reconcile tracked worktrees against reality on disk.
 *
 * Simulates what a supervisor does on startup after a crash:
 * 1. Read the tracking record (what we thought existed)
 * 2. Check which tracked paths still exist on disk
 * 3. Run `git worktree prune` so git cleans up its own stale metadata
 *
 * Note: `git worktree list` is NOT the source of truth here — after a crash
 * git still reports worktrees whose directories were deleted; only `prune`
 * updates git's metadata. The real check is whether the directory exists.
 *
 * Returns paths that were found to be orphaned (directory gone from disk).
 */
export async function reconcileWorktrees(
  repoPath: string,
  tracked: WorktreeRecord[],
): Promise<{ orphaned: string[]; pruned: boolean }> {
  // Normalize tracked paths — on macOS /tmp is a symlink to /private/tmp,
  // so git and mkdtemp can report different strings for the same location.
  const normalizedTracked = await Promise.all(
    tracked.map(async (w) => ({ ...w, path: await normalizePath(w.path) })),
  );

  // A worktree is orphaned if its directory no longer exists on disk.
  const orphaned: string[] = [];
  for (const w of normalizedTracked) {
    if (!(await Bun.file(join(w.path, ".git")).exists())) {
      orphaned.push(w.path);
    }
  }

  // git worktree prune cleans up stale .git/worktrees/<name> metadata
  const pruneResult = await Bun.$`git -C ${repoPath} worktree prune`.quiet();

  return { orphaned, pruned: pruneResult.exitCode === 0 };
}

/**
 * Handle a locked worktree by removing the lock file and then pruning.
 * Returns true if the lock was found and removed.
 */
export async function unlockWorktree(repoPath: string, worktreeName: string): Promise<boolean> {
  const lockPath = join(repoPath, ".git", "worktrees", worktreeName, "locked");
  const lockFile = Bun.file(lockPath);
  if (!(await lockFile.exists())) return false;

  await rm(lockPath);
  await Bun.$`git -C ${repoPath} worktree prune`.quiet();
  return true;
}

// ── Demo run ──────────────────────────────────────────────────────────────────

async function demo() {
  // Use a fixed path inside the project root so it's visible in VSCode and Finder
  const tmpBase = join(import.meta.dir, "..", "tmp-worktree-demo");
  await rm(tmpBase, { recursive: true, force: true }); // clean up any previous run
  const repoPath = join(tmpBase, "repo");
  const worktreePath = join(tmpBase, "worktrees", "task-1");

  try {
    await mkdir(repoPath, { recursive: true });

    // Set up a bare git repo with one commit so worktrees can be created
    await Bun.$`git init ${repoPath}`.quiet();
    await Bun.$`git -C ${repoPath} config user.email "spike@afk"`.quiet();
    await Bun.$`git -C ${repoPath} config user.name "AFK Spike"`.quiet();
    await Bun.$`touch ${join(repoPath, "README.md")}`.quiet();
    await Bun.$`git -C ${repoPath} add .`.quiet();
    await Bun.$`git -C ${repoPath} commit -m "init"`.quiet();

    console.log("── Create worktree ─────────────────────────────────");
    await createWorktree(repoPath, worktreePath, "afk/task-1");
    const after = await listWorktrees(repoPath);
    console.log("Worktrees:", after.map((w) => `${w.branch} @ ${w.path}`));
    console.log("\nWorktree created. Sleeping 20s — check VSCode file tree now.");
    await Bun.sleep(20_000);

    console.log("\n── Simulate crash (skip removeWorktree) ───────────");
    // Store the resolved path — same as what git reports — so reconcile comparison works
    const resolvedWorktreePath = await normalizePath(worktreePath);
    const tracked: WorktreeRecord[] = [{ path: resolvedWorktreePath, branch: "afk/task-1", head: "" }];
    // Manually delete the directory — simulates filesystem vanishing (e.g. tmpfs wipe)
    await rm(worktreePath, { recursive: true, force: true });

    console.log("\n── Supervisor restarts: reconcile ─────────────────");
    const { orphaned, pruned } = await reconcileWorktrees(repoPath, tracked);
    console.log("Orphaned paths:", orphaned);
    console.log("git worktree prune succeeded:", pruned);

    const afterReconcile = await listWorktrees(repoPath);
    console.log("Worktrees after reconcile:", afterReconcile.map((w) => w.path));

    console.log("\n── Done ────────────────────────────────────────────");
    console.log("Spike complete. All scenarios passed.");
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
}

// Only run the demo when executed directly, not when imported by tests
if (import.meta.main) {
  demo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
