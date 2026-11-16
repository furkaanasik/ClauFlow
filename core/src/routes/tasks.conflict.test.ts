import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-taskconflict-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-taskconflict-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { __setResolvingForTest, isResolving, resolverRuntime } from "../agents/conflictResolver.js";
import { createTask, getTask, updateTask } from "../services/taskService.js";
import { BUILTIN_TEAM_IDS } from "../services/teamTemplates.js";
import { addBareOrigin, installFakeGh } from "../test-utils/fakeGh.js";
import { git, readCalls, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import { cleanupTeamCases, makeTeamCase, type TeamCase } from "../test-utils/teamHarness.js";
import type { Task } from "../types/index.js";
import githubRouter from "./github.js";
import tasksRouter from "./tasks.js";

let server: TestServer;
const extraDirs: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
}

/** Waits until the task's resolver run (if any) is over and returns the row. */
async function untilSettled(taskId: string, ms = 15_000): Promise<Task> {
  const start = Date.now();
  for (;;) {
    const t = (await getTask(taskId))!;
    if (t.agent.status !== "resolving_conflict" && !isResolving(taskId)) return t;
    if (Date.now() - start > ms) throw new Error(`resolver for ${taskId} did not settle`);
    await sleep(25);
  }
}

/** Waits for `currentStep` (e.g. "conflict_resolved"); fails fast on another end state. */
async function untilAgent(taskId: string, step: string): Promise<Task> {
  const t = await untilSettled(taskId);
  expect(t.agent.currentStep, `agent: ${JSON.stringify(t.agent.error)}`).toBe(step);
  return t;
}

const resolverCalls = (c: TeamCase) => readCalls(c.state).filter((x) => x.role === "conflict_resolver");

interface Pair extends TeamCase {
  /** A: changes `shared.txt`'s line, in review with its branch. */
  a: Task;
  branchA: string;
  /** B (the case's task): same line from the same base, in review. */
  branchB: string;
  base0: string;
}

/**
 * Two sibling tasks off the same base that change the same line of
 * `shared.txt` (`clean`: B touches another file). Both in review with their
 * branches; nothing merged yet. `remote`: a bare origin with every branch pushed.
 */
async function pair(opts: { clean?: boolean; remote?: boolean } = {}): Promise<Pair> {
  const c = await makeTeamCase({
    scenario: "pass",
    teamId: BUILTIN_TEAM_IDS.yazilimEkibi,
    project: { defaultTeamId: null },
    title: "Say hello from B",
    setupRepo: (repo) => {
      writeRepoFile(repo, "shared.txt", "base line\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "seed shared.txt");
    },
  });
  const repo = c.repo;
  const base0 = git(repo, "rev-parse", "HEAD");
  const created = await createTask({ projectId: c.project.id, title: "Say hello from A" });
  const branchA = `feature/${created.displayId!.toLowerCase()}-hello-a`;
  git(repo, "checkout", "-q", "-b", branchA);
  writeRepoFile(repo, "shared.txt", "line from A\n");
  git(repo, "commit", "-q", "-am", "feat: A");
  git(repo, "checkout", "-q", "main");

  const branchB = `feature/${c.task.displayId!.toLowerCase()}-hello-b`;
  git(repo, "checkout", "-q", "-b", branchB, base0);
  if (opts.clean) writeRepoFile(repo, "other.txt", "B's own file\n");
  else writeRepoFile(repo, "shared.txt", "line from B\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat: B");
  git(repo, "checkout", "-q", "main");

  if (opts.remote) {
    extraDirs.push(addBareOrigin(repo));
    git(repo, "push", "-q", "-u", "origin", branchA, branchB);
  }
  const reviewed = { status: "review" as const, agent: { status: "done" as const, error: null } };
  const a = await updateTask(created.id, { ...reviewed, branch: branchA });
  const task = await updateTask(c.task.id, { ...reviewed, branch: branchB });
  return { ...c, task, a, branchA, branchB, base0 };
}

/** Everything a request must not change in git. */
const gitSnapshot = (repo: string) => ({
  refs: git(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
  head: git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
  status: git(repo, "status", "--porcelain"),
  stash: git(repo, "stash", "list"),
});

beforeAll(async () => {
  server = await startTestServer([
    ["/api/tasks", tasksRouter],
    ["/api/github", githubRouter],
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await server.close();
  cleanupTeamCases();
  for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

describe("PATCH review → done: merge conflict starts the resolver (zincir F4.6, §3/32)", () => {
  it("409 resolving + files; the resolver ends conflict_resolved; the second Done merges (two merge commits)", async () => {
    const c = await pair();
    expect((await call("PATCH", `/api/tasks/${c.a.id}`, { status: "done" })).status).toBe(200);

    const r = await call("PATCH", `/api/tasks/${c.task.id}`, { status: "done", uiLang: "en" });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "merge_conflict", files: ["shared.txt"], resolving: true });
    const queued = (await getTask(c.task.id))!;
    expect(queued.status).toBe("review");
    expect(queued.agent.status).toBe("resolving_conflict");

    const resolved = await untilAgent(c.task.id, "conflict_resolved");
    expect(resolved).toMatchObject({ status: "review", branch: c.branchB });
    expect(resolved.agent).toMatchObject({ status: "done", error: null });
    expect(resolverCalls(c)).toHaveLength(1);
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");

    const done = await call("PATCH", `/api/tasks/${c.task.id}`, { status: "done" });
    expect(done.status).toBe(200);
    expect(done.json!.task).toMatchObject({ status: "done", branch: null });
    const merges = git(c.repo, "log", "--merges", "--first-parent", "--format=%s", "main").split("\n");
    expect(merges).toEqual([
      `Merge ${c.branchB} (${c.task.displayId})`,
      `Merge ${c.branchA} (${c.a.displayId})`,
    ]);
    const shared = git(c.repo, "show", "main:shared.txt");
    expect(shared).toContain("line from A");
    expect(shared).toContain("line from B");
  });

  it("one automatic attempt: after a failed run the next Done answers resolving:false; POST /resolve runs again", async () => {
    const c = await pair();
    vi.stubEnv("FAKE_CLAUDE_RESOLVE", "leave_markers");
    expect((await call("PATCH", `/api/tasks/${c.a.id}`, { status: "done" })).status).toBe(200);

    const first = await call("PATCH", `/api/tasks/${c.task.id}`, { status: "done" });
    expect(first.json).toMatchObject({ error: "merge_conflict", resolving: true });
    const failed = await untilSettled(c.task.id);
    expect(failed.agent).toMatchObject({ status: "error", error: "conflict_unresolved:markers_left" });
    expect(resolverCalls(c)).toHaveLength(1);

    const spy = vi.spyOn(resolverRuntime, "startResolution");
    const second = await call("PATCH", `/api/tasks/${c.task.id}`, { status: "done" });
    expect(second.status).toBe(409);
    expect(second.json).toEqual({ error: "merge_conflict", files: ["shared.txt"], resolving: false });
    await sleep(50);
    expect(spy).not.toHaveBeenCalled();
    expect(resolverCalls(c)).toHaveLength(1);
    expect((await getTask(c.task.id))!.agent).toMatchObject({ status: "error", error: "merge_conflict" });
    spy.mockRestore();

    vi.stubEnv("FAKE_CLAUDE_RESOLVE", "keep_both");
    const manual = await call("POST", `/api/tasks/${c.task.id}/resolve`, { uiLang: "tr" });
    expect(manual.status).toBe(202);
    expect(manual.json!.task).toMatchObject({ id: c.task.id, status: "review" });
    expect(manual.json!.task.agent).toMatchObject({ status: "resolving_conflict", currentStep: "queued", error: null });
    await untilAgent(c.task.id, "conflict_resolved");
    expect(resolverCalls(c)).toHaveLength(2);
  });
});

describe("POST /api/tasks/:id/resolve (§3/46, §5.10)", () => {
  it("409 task_not_in_review / no_branch / conflict_resolving; 400 on a bad mode", async () => {
    const c = await pair();
    const todo = await updateTask(c.a.id, { status: "todo" });
    expect(await call("POST", `/api/tasks/${todo.id}/resolve`, {})).toEqual({
      status: 409,
      json: { error: "task_not_in_review" },
    });

    git(c.repo, "branch", "-q", "-D", c.branchB);
    expect(await call("POST", `/api/tasks/${c.task.id}/resolve`, { mode: "conflict" })).toEqual({
      status: 409,
      json: { error: "no_branch" },
    });
    const noBranch = await updateTask(c.task.id, { branch: null });
    expect((await call("POST", `/api/tasks/${noBranch.id}/resolve`, {})).json).toEqual({ error: "no_branch" });

    const fake = __setResolvingForTest(c.task.id, "running");
    try {
      expect(await call("POST", `/api/tasks/${c.task.id}/resolve`, {})).toEqual({
        status: 409,
        json: { error: "conflict_resolving" },
      });
    } finally {
      fake.release();
    }
    expect((await call("POST", `/api/tasks/${c.task.id}/resolve`, { mode: "rebase" })).status).toBe(400);
    expect((await call("POST", `/api/tasks/nope/resolve`, {})).status).toBe(404);
  });

  it("mode update with behind = 0 → 409 branch_up_to_date; git and the row untouched", async () => {
    const c = await pair();
    const before = gitSnapshot(c.repo);
    const rowBefore = (await getTask(c.task.id))!;
    const r = await call("POST", `/api/tasks/${c.task.id}/resolve`, { mode: "update" });
    expect(r).toEqual({ status: 409, json: { error: "branch_up_to_date" } });
    expect(gitSnapshot(c.repo)).toEqual(before);
    const rowAfter = (await getTask(c.task.id))!;
    expect(rowAfter.agent).toEqual(rowBefore.agent);
    expect(isResolving(c.task.id)).toBe(false);
  });

  it("mode update with the base ahead and no conflict → 202, clean merge, no AI call", async () => {
    const c = await pair({ clean: true });
    expect((await call("PATCH", `/api/tasks/${c.a.id}`, { status: "done" })).status).toBe(200);
    const r = await call("POST", `/api/tasks/${c.task.id}/resolve`, { mode: "update", uiLang: "en" });
    expect(r.status).toBe(202);
    await untilAgent(c.task.id, "conflict_resolved");
    expect(readCalls(c.state)).toEqual([]);
    expect(git(c.repo, "merge-base", "--is-ancestor", "main", c.branchB)).toBe("");
  });
});

describe("GET /api/tasks/:id/base-drift (§3/46)", () => {
  it("behind 1 when the base moved, 0 when it did not, 0 without a branch", async () => {
    const c = await pair();
    expect((await call("GET", `/api/tasks/${c.task.id}/base-drift`)).json).toEqual({
      base: "main",
      target: "main",
      behind: 0,
      mergeBase: c.base0,
    });
    // One commit on the base (a --no-ff merge would add two).
    writeRepoFile(c.repo, "base.txt", "moved\n");
    git(c.repo, "add", "-A");
    git(c.repo, "commit", "-q", "-m", "chore: base moves");
    const moved = await call("GET", `/api/tasks/${c.task.id}/base-drift`);
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ base: "main", target: "main", behind: 1, mergeBase: c.base0 });

    const noBranch = await updateTask(c.task.id, { branch: null });
    expect((await call("GET", `/api/tasks/${noBranch.id}/base-drift`)).json).toMatchObject({ behind: 0 });
    expect((await call("GET", `/api/tasks/nope/base-drift`)).status).toBe(404);
  });
});

describe("PR path (§3/34, Z35)", () => {
  it("a conflicting PR: PATCH done → 409 merge_conflict + resolving; the resolver merges origin/main and pushes", async () => {
    const gh = installFakeGh();
    try {
      const c = await pair({ remote: true });
      // A is merged on "GitHub": origin/main moves, the local base stays stale.
      git(c.repo, "checkout", "-q", "main");
      git(c.repo, "merge", "-q", "--no-ff", "-m", `Merge pull request #6 from acme/${c.branchA}`, c.branchA);
      git(c.repo, "push", "-q", "origin", "main");
      git(c.repo, "reset", "-q", "--hard", c.base0);
      await updateTask(c.a.id, { status: "done", branch: null });
      const withPr = await updateTask(c.task.id, { prNumber: 7, prUrl: "https://github.com/acme/fake/pull/7" });

      vi.stubEnv("FAKE_GH_MERGE_CONFLICT", "1");
      const r = await call("PATCH", `/api/tasks/${withPr.id}`, { status: "done" });
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ error: "merge_conflict", files: [], resolving: true });
      expect(gh.calls()).toEqual(
        expect.arrayContaining(["pr merge 7 --merge --delete-branch", "pr view 7 --json mergeable,mergeStateStatus"]),
      );
      const resolved = await untilAgent(c.task.id, "conflict_resolved");
      expect(resolved.status).toBe("review");
      const origin = extraDirs.at(-1)!;
      expect(git(origin, "rev-parse", c.branchB)).toBe(git(c.repo, "rev-parse", c.branchB));
      expect(git(c.repo, "log", "-1", "--format=%s", c.branchB)).toContain(`Merge origin/main into ${c.branchB}`);
    } finally {
      gh.restore();
    }
  });

  it("merge failure with mergeable UNKNOWN → 409 pr_merge_failed, no resolver", async () => {
    const gh = installFakeGh();
    try {
      const c = await pair({ remote: true });
      await updateTask(c.task.id, { prNumber: 7 });
      vi.stubEnv("FAKE_GH_MERGE_FAIL", "GraphQL: something went wrong");
      vi.stubEnv("FAKE_GH_MERGEABLE", "UNKNOWN");
      const spy = vi.spyOn(resolverRuntime, "startResolution");
      const r = await call("PATCH", `/api/tasks/${c.task.id}`, { status: "done" });
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ error: "pr_merge_failed" });
      await sleep(50);
      expect(spy).not.toHaveBeenCalled();
      expect(isResolving(c.task.id)).toBe(false);
      expect((await getTask(c.task.id))!.agent).toMatchObject({ status: "error", error: "pr_merge_failed" });
    } finally {
      gh.restore();
    }
  });

  it("POST /api/github/prs/7/merge: conflict → 409 (not 500) + resolver; while resolving → 409 conflict_resolving", async () => {
    const gh = installFakeGh();
    try {
      const c = await pair({ remote: true });
      await updateTask(c.task.id, { prNumber: 7 });
      vi.stubEnv("FAKE_GH_MERGE_CONFLICT", "1");
      const spy = vi.spyOn(resolverRuntime, "startResolution").mockResolvedValue();
      const r = await call("POST", `/api/github/prs/7/merge?projectId=${c.project.id}`, { uiLang: "en" });
      expect(r).toEqual({ status: 409, json: { error: "merge_conflict", files: [], resolving: true } });
      await sleep(50);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(c.task.id, { mode: "conflict", trigger: "auto", uiLang: "en" });
      expect((await getTask(c.task.id))!.agent).toMatchObject({ status: "resolving_conflict", currentStep: "queued" });

      // The row (and the queued registry entry the stub never released) guard the route.
      const callsBefore = gh.calls().length;
      const again = await call("POST", `/api/github/prs/7/merge?projectId=${c.project.id}`);
      expect(again).toEqual({ status: 409, json: { error: "conflict_resolving" } });
      expect(gh.calls()).toHaveLength(callsBefore);
      __setResolvingForTest(c.task.id).release();
      await updateTask(c.task.id, { agent: { status: "error", error: "conflict_unresolved:aborted" } });

      // An unmatched PR conflicts too: 409, nothing to resolve.
      const other = await call("POST", `/api/github/prs/99/merge?projectId=${c.project.id}`);
      expect(other).toEqual({ status: 409, json: { error: "merge_conflict", files: [], resolving: false } });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      gh.restore();
    }
  });
});
