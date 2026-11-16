import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-stash-${process.pid}-${Date.now()}`;
});

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { git, makeRepo, writeRepoFile } from "../test-utils/fakeRepo.js";
import { checkoutBase } from "./gitService.js";
import { createComment } from "./commentService.js";
import { createProject, createTask } from "./taskService.js";
import {
  dropStash,
  getStashDetail,
  listClauflowStashes,
  parseStashLabel,
  restoreStash,
  StashError,
} from "./stashService.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

function repo(): string {
  const r = makeRepo("clauflow-stash-");
  dirs.push(r);
  return r;
}

async function stashError(p: Promise<unknown>): Promise<StashError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(StashError);
    return e as StashError;
  }
  throw new Error("expected a StashError");
}

const ISO = "2026-11-16T03:40:12.345Z";

describe("parseStashLabel (pure)", () => {
  it("old run label without a task", () => {
    expect(parseStashLabel(`kanban-auto-${ISO}`)).toEqual({ reason: "run" });
    expect(parseStashLabel(`kanban-pull-auto-${ISO}`)).toEqual({ reason: "run" });
  });

  it("new run label carries the task id", () => {
    expect(parseStashLabel(`kanban-auto-task_ab12cd34-${ISO}`)).toEqual({ reason: "run", taskId: "task_ab12cd34" });
    expect(parseStashLabel(`kanban-pull-auto-task_ab12cd34-${ISO}`)).toEqual({
      reason: "run",
      taskId: "task_ab12cd34",
    });
  });

  it("merge, comment and resolve labels", () => {
    expect(parseStashLabel("clauflow-merge-task_1")).toEqual({ reason: "merge", taskId: "task_1" });
    expect(parseStashLabel("clauflow-comment-cmt_9")).toEqual({ reason: "comment", commentId: "cmt_9" });
    expect(parseStashLabel("clauflow-resolve-task_2")).toEqual({ reason: "resolve", taskId: "task_2" });
  });

  it("a run's discard stashes and user labels are not ClauFlow's to show", () => {
    expect(parseStashLabel("clauflow-discard-run_1-developer-2")).toBeNull();
    expect(parseStashLabel("mine")).toBeNull();
    expect(parseStashLabel("WIP on main: abc123 init")).toBeNull();
    expect(parseStashLabel("")).toBeNull();
  });
});

describe("listClauflowStashes", () => {
  it("only ClauFlow stashes, newest first, files filled; task and display id resolved", async () => {
    const r = repo();
    const project = await createProject({ name: "st", repoPath: r, defaultBranch: "main", slug: `st${Date.now().toString(36)}` });
    const task = await createTask({ projectId: project.id, title: "x" });
    const comment = createComment(task.id, "hi");

    writeRepoFile(r, "README.md", "# run edit\n");
    writeRepoFile(r, "new.txt", "untracked\n");
    const co = await checkoutBase(r, "main", { taskId: task.id });
    expect(co.code).toBe(0);
    expect(co.stashed).toMatch(new RegExp(`^kanban-auto-${task.id}-\\d{4}-`));

    writeRepoFile(r, "mine.txt", "user\n");
    git(r, "stash", "push", "-u", "-m", "mine");
    writeRepoFile(r, "c.txt", "comment\n");
    git(r, "stash", "push", "-u", "-m", `clauflow-comment-${comment.id}`);
    writeRepoFile(r, "d.txt", "discard\n");
    git(r, "stash", "push", "-u", "-m", "clauflow-discard-run_1-developer-1");

    const list = await listClauflowStashes(r);
    expect(list.map((s) => s.reason)).toEqual(["comment", "run"]);
    const [c, run] = list;
    expect(c).toMatchObject({ label: `clauflow-comment-${comment.id}`, taskId: task.id, displayId: task.displayId, files: ["c.txt"] });
    expect(run).toMatchObject({ label: co.stashed, taskId: task.id, displayId: task.displayId });
    expect(run!.files.sort()).toEqual(["README.md", "new.txt"]);
    expect(run!.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(run!.createdAt))).toBe(false);
  });

  it("missing path or not a git repo → []", async () => {
    expect(await listClauflowStashes("/nonexistent/clauflow-stash")).toEqual([]);
    const plain = repo();
    rmSync(join(plain, ".git"), { recursive: true, force: true });
    expect(await listClauflowStashes(plain)).toEqual([]);
  });
});

describe("restoreStash / dropStash (§3/27)", () => {
  it("clean restore: the dirty files come back (untracked too) and the stash leaves the list", async () => {
    const r = repo();
    writeRepoFile(r, "README.md", "# dirty\n");
    writeRepoFile(r, "stray.txt", "untracked\n");
    const co = await checkoutBase(r, "main", { taskId: "task_restore" });
    expect(git(r, "status", "--porcelain")).toBe("");
    const [entry] = await listClauflowStashes(r);
    expect(entry!.label).toBe(co.stashed);

    const res = await restoreStash(r, entry!.ref);

    expect(res).toEqual({ restored: co.stashed, branch: "main" });
    expect(readFileSync(join(r, "README.md"), "utf8")).toBe("# dirty\n");
    expect(readFileSync(join(r, "stray.txt"), "utf8")).toBe("untracked\n");
    expect(await listClauflowStashes(r)).toEqual([]);
    expect(git(r, "stash", "list")).toBe("");
  });

  it("conflicting restore: stash_conflict + files, tree clean, stash still listed", async () => {
    const r = repo();
    writeRepoFile(r, "README.md", "# stashed side\n");
    writeRepoFile(r, "extra.txt", "untracked\n");
    await checkoutBase(r, "main", { taskId: "task_conflict" });
    writeRepoFile(r, "README.md", "# base side\n");
    git(r, "commit", "-q", "-am", "chore: base edit");
    const head = git(r, "rev-parse", "HEAD");
    const [entry] = await listClauflowStashes(r);

    const err = await stashError(restoreStash(r, entry!.ref));

    expect(err.code).toBe("stash_conflict");
    expect(err.extra.files).toEqual(["README.md"]);
    expect(git(r, "status", "--porcelain")).toBe("");
    expect(git(r, "rev-parse", "HEAD")).toBe(head);
    expect(existsSync(join(r, "extra.txt"))).toBe(false);
    expect((await listClauflowStashes(r)).map((s) => s.ref)).toEqual([entry!.ref]);
  });

  it("dirty tree → worktree_dirty, nothing changes", async () => {
    const r = repo();
    writeRepoFile(r, "README.md", "# dirty\n");
    await checkoutBase(r, "main", { taskId: "task_dirty" });
    writeRepoFile(r, "new-work.txt", "user's new work\n");
    const [entry] = await listClauflowStashes(r);

    const err = await stashError(restoreStash(r, entry!.ref));

    expect(err.code).toBe("worktree_dirty");
    expect(git(r, "status", "--porcelain")).toBe("?? new-work.txt");
    expect(readFileSync(join(r, "README.md"), "utf8")).toBe("# fake repo\n");
    expect((await listClauflowStashes(r)).length).toBe(1);
  });

  it("unknown SHA or a user's own stash → stash_not_found", async () => {
    const r = repo();
    expect((await stashError(restoreStash(r, "0".repeat(40)))).code).toBe("stash_not_found");
    writeRepoFile(r, "mine.txt", "user\n");
    git(r, "stash", "push", "-u", "-m", "mine");
    const mine = git(r, "rev-parse", "stash@{0}");
    expect((await stashError(restoreStash(r, mine))).code).toBe("stash_not_found");
    expect((await stashError(dropStash(r, mine))).code).toBe("stash_not_found");
    expect(git(r, "stash", "list")).toContain("mine");
  });

  it("dropStash drops only that stash, by SHA, even after indices shift", async () => {
    const r = repo();
    writeRepoFile(r, "a.txt", "a\n");
    git(r, "stash", "push", "-u", "-m", "clauflow-merge-task_a");
    writeRepoFile(r, "b.txt", "b\n");
    git(r, "stash", "push", "-u", "-m", "clauflow-merge-task_b");
    const target = git(r, "rev-parse", "stash@{1}"); // task_a
    writeRepoFile(r, "c.txt", "c\n");
    git(r, "stash", "push", "-u", "-m", "clauflow-merge-task_c"); // task_a is now stash@{2}

    expect(await dropStash(r, target)).toEqual({ dropped: "clauflow-merge-task_a" });

    expect((await listClauflowStashes(r)).map((s) => s.label)).toEqual([
      "clauflow-merge-task_c",
      "clauflow-merge-task_b",
    ]);
  });
});

describe("getStashDetail + list summary (bakim #6, §3/14–16)", () => {
  /** Mixed stash: code, 1 000 untracked node_modules files, a changed lock, a deleted tracked file. */
  function mixedStash(r: string): string {
    writeRepoFile(r, "package-lock.json", '{"v":1}\n');
    writeRepoFile(r, "src/old.ts", "export const old = 1;\n");
    git(r, "add", "-A");
    git(r, "commit", "-q", "-m", "base files");
    writeRepoFile(r, "package-lock.json", '{"v":2}\n');
    rmSync(join(r, "src", "old.ts"));
    writeRepoFile(r, "src/app.ts", "export const app = 1;\n");
    writeRepoFile(r, "README.md", "# edited\n");
    for (let i = 0; i < 1000; i++) writeRepoFile(r, `node_modules/p${i % 50}/f${i}.js`, `${i}\n`);
    git(r, "stash", "push", "-u", "-m", "clauflow-merge-task_mixed");
    return git(r, "rev-parse", "stash@{0}");
  }

  it("mixed stash: counts, code files incl. the deleted one, one node_modules/ group, not safe", async () => {
    const r = repo();
    const sha = mixedStash(r);

    const t0 = Date.now();
    const d = await getStashDetail(r, sha);
    const ms = Date.now() - t0;
    console.log(`[bakim F3/1] 1 000-file stash detail: ${ms} ms`);
    expect(ms).toBeLessThan(2000);

    expect(d.ref).toBe(sha);
    expect(d.label).toBe("clauflow-merge-task_mixed");
    expect(d.summary).toEqual({ total: 1004, deps: 1000, build: 0, lockOs: 1, code: 3, untracked: 1001 });
    expect(d.safeToDrop).toBe(false);
    expect(d.codeFiles).toEqual([
      { path: "README.md", status: "M", class: "code" },
      { path: "src/app.ts", status: "U", class: "code" },
      { path: "src/old.ts", status: "D", class: "code" },
    ]);
    expect(d.lockOsFiles).toEqual([{ path: "package-lock.json", status: "M", class: "lock_os" }]);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]).toMatchObject({ root: "node_modules/", class: "deps", count: 1000 });
    expect(d.groups[0]!.sample.length).toBe(200);
    expect(d.truncated).toBe(false);

    const [entry] = await listClauflowStashes(r);
    expect(entry!.summary).toEqual(d.summary);
    expect(entry!.safeToDrop).toBe(false);
    expect(entry!.files.length).toBe(20); // kept for compatibility
  });

  it("only node_modules + .DS_Store → safeToDrop", async () => {
    const r = repo();
    for (let i = 0; i < 5; i++) writeRepoFile(r, `node_modules/x/${i}.js`, "x\n");
    writeRepoFile(r, ".DS_Store", "os\n");
    git(r, "stash", "push", "-u", "-m", "clauflow-merge-task_safe");
    const sha = git(r, "rev-parse", "stash@{0}");

    const d = await getStashDetail(r, sha);

    expect(d.summary).toEqual({ total: 6, deps: 5, build: 0, lockOs: 1, code: 0, untracked: 6 });
    expect(d.safeToDrop).toBe(true);
    expect(d.codeFiles).toEqual([]);
    expect((await listClauflowStashes(r))[0]!.safeToDrop).toBe(true);
  });

  it("a stash without a third parent (tracked changes only) works", async () => {
    const r = repo();
    writeRepoFile(r, "README.md", "# tracked only\n");
    git(r, "stash", "push", "-m", "clauflow-merge-task_tracked");
    const sha = git(r, "rev-parse", "stash@{0}");
    expect(() => git(r, "rev-parse", "-q", "--verify", `${sha}^3`)).toThrow();

    const d = await getStashDetail(r, sha);

    expect(d.summary).toEqual({ total: 1, deps: 0, build: 0, lockOs: 0, code: 1, untracked: 0 });
    expect(d.codeFiles).toEqual([{ path: "README.md", status: "M", class: "code" }]);
    expect(d.groups).toEqual([]);
  });

  it("a user's own stash is stash_not_found", async () => {
    const r = repo();
    writeRepoFile(r, "mine.txt", "user\n");
    git(r, "stash", "push", "-u", "-m", "mine");
    const e = await stashError(getStashDetail(r, git(r, "rev-parse", "stash@{0}")));
    expect(e.code).toBe("stash_not_found");
  });
});
