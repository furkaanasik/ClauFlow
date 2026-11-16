import { checkoutBase, mergePr, run } from "./gitService.js";
import { tryAcquireRepoLock } from "./repoLock.js";
import { invalidateHasRemote, repoHasRemote } from "./remoteInfo.js";
import { branchExists } from "./taskDiff.js";
import type { Project, Task } from "../types/index.js";

/**
 * The one way a task branch gets merged (plan D1, §5.2):
 * - PR → `gh pr merge <n> --merge --delete-branch`, then back to base;
 * - no remote → local `git merge --no-ff` into base, then `git branch -d`;
 * - nothing to merge (no branch) → skipped.
 * Every git write happens under the repo lock; HTTP callers never wait for it.
 */

type MergeFailCode = "repo_busy" | "merge_conflict" | "merge_failed" | "pr_merge_failed";

type MergeResult =
  | {
      ok: true;
      mode: "pr" | "local" | "skipped";
      /** The task branch is gone (merged and deleted, or never existed). */
      branchDeleted: boolean;
      mergeCommit?: string;
      /** Label of the stash that took a dirty working tree aside. */
      stash?: string;
      /** Why a merge was skipped or what went wrong after a successful merge. */
      note?: string;
    }
  | {
      ok: false;
      code: MergeFailCode;
      files?: string[];
      detail?: string;
      /** A dirty tree was stashed before the merge failed (the stash stays). */
      stash?: string;
    };

function out(r: { stdout: string; stderr: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).slice(0, 2000);
}

/** Merges PR `prNumber` on GitHub and returns the local repo to base. */
export async function mergePullRequest(
  project: Project,
  prNumber: number,
  owner: string,
): Promise<MergeResult> {
  const lease = tryAcquireRepoLock(project.repoPath, owner);
  if (!lease) return { ok: false, code: "repo_busy" };
  try {
    const merged = await mergePr(project.repoPath, prNumber);
    if (merged.code !== 0) return { ok: false, code: "pr_merge_failed", detail: out(merged) };
    const co = await checkoutBase(project.repoPath, project.defaultBranch);
    return {
      ok: true,
      mode: "pr",
      branchDeleted: true,
      ...(co.code !== 0 ? { note: `post-merge checkout failed: ${out(co)}` } : {}),
    };
  } finally {
    lease.release();
  }
}

async function mergeLocally(task: Task, project: Project, branch: string): Promise<MergeResult> {
  const repo = project.repoPath;
  const base = project.defaultBranch;
  const lease = tryAcquireRepoLock(repo, `merge:${task.id}`);
  if (!lease) return { ok: false, code: "repo_busy" };
  try {
    let stash: string | undefined;
    const dirty = await run("git", ["status", "--porcelain"], repo);
    if (dirty.code === 0 && dirty.stdout.trim() !== "") {
      stash = `clauflow-merge-${task.id}`;
      const st = await run("git", ["stash", "push", "--include-untracked", "--message", stash], repo);
      if (st.code !== 0) return { ok: false, code: "merge_failed", detail: out(st) };
    }

    const co = await run("git", ["checkout", base], repo);
    if (co.code !== 0) return { ok: false, code: "merge_failed", detail: out(co), ...(stash ? { stash } : {}) };

    const message = `Merge ${branch} (${task.displayId ?? task.id})`;
    const merge = await run("git", ["merge", "--no-ff", "-m", message, branch], repo);
    if (merge.code !== 0) {
      const unmerged = await run("git", ["diff", "--name-only", "--diff-filter=U"], repo);
      const files = unmerged.stdout.split("\n").map((f) => f.trim()).filter(Boolean);
      const inMerge = await run("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], repo);
      if (inMerge.code === 0) await run("git", ["merge", "--abort"], repo);
      return files.length > 0
        ? { ok: false, code: "merge_conflict", files, ...(stash ? { detail: `stash: ${stash}`, stash } : {}) }
        : { ok: false, code: "merge_failed", detail: out(merge), ...(stash ? { stash } : {}) };
    }

    const head = await run("git", ["rev-parse", "HEAD"], repo);
    const del = await run("git", ["branch", "-d", branch], repo);
    return {
      ok: true,
      mode: "local",
      branchDeleted: del.code === 0,
      mergeCommit: head.stdout.trim(),
      ...(stash ? { stash } : {}),
      ...(del.code !== 0 ? { note: `git branch -d failed: ${out(del)}` } : {}),
    };
  } finally {
    lease.release();
  }
}

export async function mergeTaskBranch(task: Task, project: Project): Promise<MergeResult> {
  if (task.prNumber) return mergePullRequest(project, task.prNumber, `merge:${task.id}`);

  const branch = task.branch;
  if (!branch || !(await branchExists(project.repoPath, branch))) {
    return { ok: true, mode: "skipped", branchDeleted: true, note: "no_branch" };
  }

  invalidateHasRemote(project.repoPath);
  if (await repoHasRemote(project.repoPath)) {
    // A branch without a PR in a repo with a remote: merging locally would
    // fork base from origin. Leave the branch for the user.
    return { ok: true, mode: "skipped", branchDeleted: false, note: "remote_without_pr" };
  }

  return mergeLocally(task, project, branch);
}
