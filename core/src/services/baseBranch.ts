import { run } from "./gitService.js";

/**
 * Read-only git probes for the project's base branch (zincir F0.5, plan §5.0).
 * None of these write to the repo, so they are safe without the repo lock.
 */

export async function baseBranchExists(repoPath: string, branch: string): Promise<boolean> {
  if (!branch) return false;
  try {
    const r = await run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repoPath);
    return r.code === 0;
  } catch {
    return false;
  }
}

/** The checked-out branch, or null when HEAD is detached or unborn-without-symref. */
export async function currentBranch(repoPath: string): Promise<string | null> {
  try {
    const r = await run("git", ["symbolic-ref", "--short", "-q", "HEAD"], repoPath);
    const name = r.stdout.trim();
    return r.code === 0 && name ? name : null;
  } catch {
    return null;
  }
}

export async function listLocalBranches(repoPath: string): Promise<string[]> {
  try {
    const r = await run("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], repoPath);
    if (r.code !== 0) return [];
    return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function repoHasCommits(repoPath: string): Promise<boolean> {
  try {
    const r = await run("git", ["rev-parse", "--verify", "--quiet", "HEAD"], repoPath);
    return r.code === 0;
  } catch {
    return false;
  }
}

/**
 * The hint stored after `base_branch_missing:` — the branch the repo is on,
 * or "-" when HEAD is detached or the repo has no commits.
 */
export async function baseBranchHint(repoPath: string): Promise<string> {
  if (!(await repoHasCommits(repoPath))) return "-";
  return (await currentBranch(repoPath)) ?? "-";
}

/**
 * Branch to suggest when the configured one is missing: the current branch,
 * else the only local branch, else null.
 */
export async function detectBaseBranch(repoPath: string): Promise<string | null> {
  if (await repoHasCommits(repoPath)) {
    const cur = await currentBranch(repoPath);
    if (cur && (await baseBranchExists(repoPath, cur))) return cur;
  }
  const branches = await listLocalBranches(repoPath);
  return branches.length === 1 ? branches[0]! : null;
}

export class BaseBranchMissing extends Error {
  readonly current: string;
  constructor(current: string) {
    super(`base_branch_missing:${current}`);
    this.name = "BaseBranchMissing";
    this.current = current;
  }
}
