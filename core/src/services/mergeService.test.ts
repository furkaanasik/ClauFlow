import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-merge-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-merge-gh-${stamp}`;
});

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { addBareOrigin, installFakeGh } from "../test-utils/fakeGh.js";
import { git, makeRepo, writeRepoFile } from "../test-utils/fakeRepo.js";
import { mergeTaskBranch } from "./mergeService.js";
import { tryAcquireRepoLock } from "./repoLock.js";
import { createProject, createTask, updateTask } from "./taskService.js";
import type { Project, Task } from "../types/index.js";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

const BRANCH = "feature/clf-1-x";

/** Repo with BRANCH one commit ahead (writes `file`), and a review task on it. */
async function setup(opts: { file?: string; body?: string; remote?: boolean } = {}) {
  const repo = makeRepo("clauflow-merge-");
  dirs.push(repo);
  if (opts.remote) dirs.push(addBareOrigin(repo));
  git(repo, "checkout", "-q", "-b", BRANCH);
  writeRepoFile(repo, opts.file ?? "feature.txt", opts.body ?? "feature\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat: x");
  git(repo, "checkout", "-q", "main");
  const project: Project = await createProject({
    name: `merge ${dirs.length}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `m${dirs.length}${Date.now().toString(36)}`,
  });
  const created = await createTask({ projectId: project.id, title: "x" });
  const task: Task = await updateTask(created.id, { status: "review", branch: BRANCH });
  return { repo, project, task };
}

const branches = (repo: string) => git(repo, "branch", "--list", BRANCH);

describe("mergeTaskBranch: local (no remote)", () => {
  it("merges --no-ff into base, deletes the branch, leaves HEAD on a clean base", async () => {
    const { repo, project, task } = await setup();
    const before = git(repo, "rev-parse", "main");
    const r = await mergeTaskBranch(task, project);

    expect(r).toMatchObject({ ok: true, mode: "local", branchDeleted: true });
    const head = git(repo, "rev-parse", "HEAD");
    expect(r.ok && r.mergeCommit).toBe(head);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repo, "log", "-1", "--format=%P").split(" ")).toHaveLength(2); // a real merge commit
    expect(git(repo, "log", "-1", "--format=%P").split(" ")[0]).toBe(before);
    expect(git(repo, "log", "-1", "--format=%s")).toBe(`Merge ${BRANCH} (${task.displayId ?? task.id})`);
    expect(git(repo, "log", "--merges", "-1", "--format=%s")).toContain(BRANCH);
    expect(branches(repo)).toBe("");
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(existsSync(join(repo, "feature.txt"))).toBe(true);
  });

  it("conflict: aborts, base untouched and clean, branch kept, conflicting files listed", async () => {
    const { repo, project, task } = await setup({ file: "README.md", body: "# branch side\n" });
    writeRepoFile(repo, "README.md", "# base side\n");
    git(repo, "commit", "-q", "-am", "chore: base edit");
    const before = git(repo, "rev-parse", "main");

    const r = await mergeTaskBranch(task, project);

    expect(r).toEqual({ ok: false, code: "merge_conflict", files: ["README.md"] });
    expect(git(repo, "rev-parse", "main")).toBe(before);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(branches(repo)).toContain(BRANCH);
  });

  it("a dirty tree is stashed as clauflow-merge-<id> before merging", async () => {
    const { repo, project, task } = await setup();
    writeRepoFile(repo, "scratch.txt", "user edit\n");
    const r = await mergeTaskBranch(task, project);
    expect(r).toMatchObject({ ok: true, mode: "local", stash: `clauflow-merge-${task.id}` });
    expect(git(repo, "stash", "list")).toContain(`clauflow-merge-${task.id}`);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("no branch (seed task, old done task) or a branch that no longer exists → skipped", async () => {
    const { repo, project, task } = await setup();
    const noBranch = await updateTask(task.id, { branch: null });
    expect(await mergeTaskBranch(noBranch, project)).toMatchObject({ ok: true, mode: "skipped", branchDeleted: true });
    const gone = await updateTask(task.id, { branch: "feature/gone" });
    expect(await mergeTaskBranch(gone, project)).toMatchObject({ ok: true, mode: "skipped", branchDeleted: true });
    expect(git(repo, "log", "--merges", "--oneline")).toBe("");
  });

  it("repo lock held → repo_busy, nothing touched", async () => {
    const { repo, project, task } = await setup();
    const lease = tryAcquireRepoLock(repo, "task:other:t");
    try {
      expect(await mergeTaskBranch(task, project)).toEqual({ ok: false, code: "repo_busy" });
      expect(branches(repo)).toContain(BRANCH);
      expect(git(repo, "log", "--merges", "--oneline")).toBe("");
    } finally {
      lease!.release();
    }
  });
});

describe("mergeTaskBranch: remote", () => {
  it("PR → gh pr merge <n> --merge --delete-branch, then back on base", async () => {
    const gh = installFakeGh();
    try {
      const { repo, project, task } = await setup({ remote: true });
      git(repo, "checkout", "-q", BRANCH);
      const withPr = await updateTask(task.id, { prNumber: 42, prUrl: "https://github.com/acme/fake/pull/42" });
      const r = await mergeTaskBranch(withPr, project);
      expect(r).toEqual({ ok: true, mode: "pr", branchDeleted: true });
      expect(gh.calls()).toEqual(["pr merge 42 --merge --delete-branch"]);
      expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    } finally {
      gh.restore();
    }
  });

  it("gh failure → pr_merge_failed with the CLI's message", async () => {
    const gh = installFakeGh();
    process.env.FAKE_GH_MERGE_FAIL = "Pull request is not mergeable";
    try {
      const { project, task } = await setup({ remote: true });
      const withPr = await updateTask(task.id, { prNumber: 9 });
      expect(await mergeTaskBranch(withPr, project)).toEqual({
        ok: false,
        code: "pr_merge_failed",
        detail: "Pull request is not mergeable",
      });
    } finally {
      delete process.env.FAKE_GH_MERGE_FAIL;
      gh.restore();
    }
  });

  it("zincir F4.6 (§3/34): a conflicting PR → merge_conflict (files unknown), read via gh pr view under the lock", async () => {
    const gh = installFakeGh();
    process.env.FAKE_GH_MERGE_CONFLICT = "1";
    try {
      const { project, task } = await setup({ remote: true });
      const withPr = await updateTask(task.id, { prNumber: 7 });
      const r = await mergeTaskBranch(withPr, project);
      expect(r).toMatchObject({ ok: false, code: "merge_conflict", files: [] });
      expect(gh.calls()).toEqual([
        "pr merge 7 --merge --delete-branch",
        "pr view 7 --json mergeable,mergeStateStatus",
      ]);
    } finally {
      delete process.env.FAKE_GH_MERGE_CONFLICT;
      gh.restore();
    }
  });

  it("zincir F4.6: mergeable UNKNOWN keeps pr_merge_failed", async () => {
    const gh = installFakeGh();
    process.env.FAKE_GH_MERGE_FAIL = "GraphQL: something went wrong";
    process.env.FAKE_GH_MERGEABLE = "UNKNOWN";
    try {
      const { project, task } = await setup({ remote: true });
      const withPr = await updateTask(task.id, { prNumber: 8 });
      expect(await mergeTaskBranch(withPr, project)).toEqual({
        ok: false,
        code: "pr_merge_failed",
        detail: "GraphQL: something went wrong",
      });
    } finally {
      delete process.env.FAKE_GH_MERGE_FAIL;
      delete process.env.FAKE_GH_MERGEABLE;
      gh.restore();
    }
  });

  it("a branch without a PR in a repo with a remote is not merged locally", async () => {
    const { repo, project, task } = await setup({ remote: true });
    const r = await mergeTaskBranch(task, project);
    expect(r).toMatchObject({ ok: true, mode: "skipped", branchDeleted: false, note: "remote_without_pr" });
    expect(branches(repo)).toContain(BRANCH);
    expect(git(repo, "log", "--merges", "--oneline")).toBe("");
  });
});
