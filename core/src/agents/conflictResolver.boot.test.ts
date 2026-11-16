import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-resolver-boot-${process.pid}-${Date.now()}`;
});

import { rmSync } from "node:fs";
import { backupRef, recoverConflictRuns } from "./conflictResolver.js";
import { createProject, createTask, getTask, updateTask } from "../services/taskService.js";
import { git, makeRepo, writeRepoFile } from "../test-utils/fakeRepo.js";

const dirs: string[] = [];
let n = 0;

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

/**
 * A task in review whose branch and main changed the same line of
 * `shared.txt`, its row closed by `recoverOrphans` (`server_restart`).
 */
async function crashCase(repoPath?: string) {
  const repo = repoPath ?? makeRepo("clauflow-resolver-boot-");
  if (!repoPath) dirs.push(repo);
  n += 1;
  const project = await createProject({
    name: `boot ${n}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `boot${n}${Date.now().toString(36)}`,
  });
  const created = await createTask({ projectId: project.id, title: "B" });
  const branch = `feature/${created.displayId!.toLowerCase()}-b`;
  if (!repoPath) {
    writeRepoFile(repo, "shared.txt", "base line\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "seed shared.txt");
    git(repo, "checkout", "-q", "-b", branch);
    writeRepoFile(repo, "shared.txt", "line from B\n");
    git(repo, "commit", "-q", "-am", "feat: B");
    git(repo, "checkout", "-q", "main");
    writeRepoFile(repo, "shared.txt", "line from A\n");
    git(repo, "commit", "-q", "-am", "feat: A on main");
  }
  const task = await updateTask(created.id, {
    status: "review",
    branch,
    agent: { status: "error", error: "conflict_unresolved:server_restart" },
  });
  return { repo, project, task, branch };
}

/** What the resolver had done when the process died: backup ref, checkout, merge. */
function crashMidMerge(repo: string, taskId: string, branch: string): string {
  const pre = git(repo, "rev-parse", branch);
  git(repo, "update-ref", backupRef(taskId), pre);
  git(repo, "checkout", "-q", branch);
  try {
    git(repo, "merge", "--no-ff", "--no-commit", "main");
  } catch {
    // conflict: exit 1, MERGE_HEAD written
  }
  return pre;
}

function expectRestored(repo: string, branch: string, pre: string): void {
  expect(git(repo, "rev-parse", branch)).toBe(pre);
  expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(git(repo, "status", "--porcelain")).toBe("");
  expect(git(repo, "for-each-ref", "refs/clauflow")).toBe("");
}

const snapshot = (repo: string) => ({
  status: git(repo, "status", "--porcelain"),
  log: git(repo, "log", "--all", "--format=%H %s"),
  branch: git(repo, "branch", "--list", "-v"),
  head: git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
  refs: git(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
});

describe("recoverConflictRuns (zincir F4.6, §3/41, Z36)", () => {
  it("a half-done merge (MERGE_HEAD) on the task branch: branch back on its SHA, HEAD main, clean tree, ref gone", async () => {
    const c = await crashCase();
    const pre = crashMidMerge(c.repo, c.task.id, c.branch);
    expect(git(c.repo, "rev-parse", "-q", "--verify", "MERGE_HEAD")).not.toBe("");
    expect(git(c.repo, "status", "--porcelain")).not.toBe("");

    const r = await recoverConflictRuns();
    expect(r.restored).toContain(c.task.id);
    expectRestored(c.repo, c.branch, pre);
    expect((await getTask(c.task.id))!.agent.log.some((l) => l.startsWith("↺ Dal geri yüklendi"))).toBe(true);
  });

  it("a merge commit made before QA: the branch still goes back to its previous SHA", async () => {
    const c = await crashCase();
    const pre = crashMidMerge(c.repo, c.task.id, c.branch);
    writeRepoFile(c.repo, "shared.txt", "line from A\nline from B\n");
    git(c.repo, "add", "-A");
    git(c.repo, "commit", "-q", "--no-edit", "-m", "Merge main into branch: conflicts resolved by ClauFlow");
    expect(git(c.repo, "rev-parse", c.branch)).not.toBe(pre);

    await recoverConflictRuns();
    expectRestored(c.repo, c.branch, pre);
  });

  it("the run had already gone back to base: only the branch ref moves back", async () => {
    const c = await crashCase();
    const pre = crashMidMerge(c.repo, c.task.id, c.branch);
    writeRepoFile(c.repo, "shared.txt", "line from A\nline from B\n");
    git(c.repo, "add", "-A");
    git(c.repo, "commit", "-q", "--no-edit", "-m", "merge");
    git(c.repo, "checkout", "-q", "main");

    await recoverConflictRuns();
    expectRestored(c.repo, c.branch, pre);
  });

  it("no backup ref: the repo is not touched (status / log / branches / HEAD identical)", async () => {
    const c = await crashCase();
    // The user's own state: on the task branch, mid-merge, with a dirty file.
    git(c.repo, "checkout", "-q", c.branch);
    try {
      git(c.repo, "merge", "--no-ff", "--no-commit", "main");
    } catch {
      // conflict
    }
    writeRepoFile(c.repo, "notes.txt", "mine\n");
    const before = snapshot(c.repo);
    const r = await recoverConflictRuns();
    expect(r.restored).not.toContain(c.task.id);
    expect(snapshot(c.repo)).toEqual(before);
  });

  it("a ref without a matching task stays where it is", async () => {
    const c = await crashCase();
    const stray = backupRef("task_unknown");
    git(c.repo, "update-ref", stray, git(c.repo, "rev-parse", c.branch));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await recoverConflictRuns();
    expect(r.kept).toContain("task_unknown");
    expect(git(c.repo, "for-each-ref", "--format=%(refname)", "refs/clauflow")).toBe(stray);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(stray));
  });

  it("a project whose repo path is gone: only a console.warn", async () => {
    const missing = `/tmp/clauflow-resolver-boot-missing-${process.pid}-${Date.now()}`;
    await crashCase(missing);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recoverConflictRuns()).resolves.toMatchObject({ restored: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(missing));
  });
});
