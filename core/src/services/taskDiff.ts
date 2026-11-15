import { run } from "./gitService.js";
import type { Project, Task } from "../types/index.js";

/** Characters of unified diff sent to the drawer; the rest is cut (plan §5.2). */
export const DIFF_CHAR_CAP = 200_000;

interface TaskDiff {
  base: string;
  branch: string;
  stat: string;
  diff: string;
  truncated: boolean;
}

type TaskDiffResult =
  | { ok: true; diff: TaskDiff }
  | { ok: false; code: "no_branch" | "diff_failed"; detail?: string };

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    const r = await run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repoPath);
    return r.code === 0;
  } catch {
    return false;
  }
}

/**
 * Local diff of a task branch against base (`<base>...<branch>`, i.e. since
 * the merge base). Read-only: no checkout, no lock.
 */
export async function getTaskDiff(task: Task, project: Project): Promise<TaskDiffResult> {
  const branch = task.branch;
  if (!branch || !(await branchExists(project.repoPath, branch))) return { ok: false, code: "no_branch" };
  const range = `${project.defaultBranch}...${branch}`;
  const flags = ["--no-color", "--no-ext-diff"];
  const stat = await run("git", ["diff", "--stat", ...flags, range, "--"], project.repoPath);
  if (stat.code !== 0) return { ok: false, code: "diff_failed", detail: stat.stderr.trim() };
  const full = await run("git", ["diff", ...flags, range, "--"], project.repoPath);
  if (full.code !== 0) return { ok: false, code: "diff_failed", detail: full.stderr.trim() };

  let diff = full.stdout;
  const truncated = diff.length > DIFF_CHAR_CAP;
  if (truncated) {
    const cut = diff.lastIndexOf("\n", DIFF_CHAR_CAP);
    diff = diff.slice(0, cut > 0 ? cut + 1 : DIFF_CHAR_CAP);
  }
  return {
    ok: true,
    diff: { base: project.defaultBranch, branch, stat: stat.stdout.trimEnd(), diff, truncated },
  };
}
