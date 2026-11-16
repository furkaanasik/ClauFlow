import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-stashroutes-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-stashroutes-gh-${stamp}`;
});

// Keep the real broadcasts, but observe `stash_created` (plan §3/28).
vi.mock("../services/wsService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/wsService.js")>();
  return { ...actual, broadcastStashCreated: vi.fn() };
});

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runComment } from "../agents/commentRunner.js";
import { createComment, getComment } from "../services/commentService.js";
import { checkoutBase } from "../services/gitService.js";
import { acquireRepoLock } from "../services/repoLock.js";
import { createProject, createTask, getTask, updateTask } from "../services/taskService.js";
import { broadcastStashCreated } from "../services/wsService.js";
import { git, makeRepo, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import { cleanupTeamCases, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";
import projectsRouter from "./projects.js";
import tasksRouter from "./tasks.js";

let server: TestServer;
const dirs: string[] = [];
const stashSpy = broadcastStashCreated as unknown as Mock;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, any> | null };
}

/** A project whose repo has one ClauFlow run stash (README edit + untracked file). */
async function stashedProject() {
  const repo = makeRepo("clauflow-stashroutes-");
  dirs.push(repo);
  const project = await createProject({
    name: `sr ${dirs.length}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `sr${dirs.length}${Date.now().toString(36)}`,
  });
  const task = await createTask({ projectId: project.id, title: "x" });
  writeRepoFile(repo, "README.md", "# stashed side\n");
  writeRepoFile(repo, "stray.txt", "untracked\n");
  const co = await checkoutBase(repo, "main", { taskId: task.id });
  expect(co.stashed).toBeTruthy();
  const sha = git(repo, "rev-parse", "stash@{0}");
  return { repo, project, task, label: co.stashed!, sha };
}

beforeAll(async () => {
  server = await startTestServer([
    ["/api/projects", projectsRouter],
    ["/api/tasks", tasksRouter],
  ]);
});

beforeEach(() => {
  stashSpy.mockClear();
});

afterAll(async () => {
  await server.close();
  cleanupTeamCases();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

describe("stash endpoints (plan §3/27, §5.9)", () => {
  it("GET lists only ClauFlow stashes; the user's own stash is invisible and untouchable", async () => {
    const { repo, project, task, label, sha } = await stashedProject();
    writeRepoFile(repo, "mine.txt", "mine\n");
    git(repo, "stash", "push", "-u", "-m", "mine");
    const mine = git(repo, "rev-parse", "stash@{0}");

    const r = await call("GET", `/api/projects/${project.id}/stashes`);
    expect(r.status).toBe(200);
    expect(r.json!.stashes).toHaveLength(1);
    expect(r.json!.stashes[0]).toMatchObject({
      ref: sha,
      label,
      reason: "run",
      taskId: task.id,
      displayId: task.displayId,
    });
    expect([...r.json!.stashes[0].files].sort()).toEqual(["README.md", "stray.txt"]);

    const restoreMine = await call("POST", `/api/projects/${project.id}/stashes/${mine}/restore`);
    expect(restoreMine).toEqual({ status: 404, json: { error: "stash_not_found" } });
    const dropMine = await call("DELETE", `/api/projects/${project.id}/stashes/${mine}`);
    expect(dropMine).toEqual({ status: 404, json: { error: "stash_not_found" } });
    expect(git(repo, "stash", "list")).toContain("mine");
  });

  it("GET: unknown project 404; a repo path that is not git gives []", async () => {
    expect((await call("GET", `/api/projects/proj_nope/stashes`)).status).toBe(404);
    const plain = mkdtempSync(join(tmpdir(), "clauflow-stashroutes-plain-"));
    dirs.push(plain);
    const project = await createProject({
      name: "plain",
      repoPath: plain,
      defaultBranch: "main",
      slug: `plain${Date.now().toString(36)}`,
    });
    expect(await call("GET", `/api/projects/${project.id}/stashes`)).toEqual({ status: 200, json: { stashes: [] } });
  });

  it("POST restore 200: files back (untracked too), stash gone", async () => {
    const { repo, project, label, sha } = await stashedProject();
    const r = await call("POST", `/api/projects/${project.id}/stashes/${sha}/restore`);
    expect(r).toEqual({ status: 200, json: { restored: label, branch: "main" } });
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# stashed side\n");
    expect(readFileSync(join(repo, "stray.txt"), "utf8")).toBe("untracked\n");
    expect(git(repo, "stash", "list")).toBe("");
  });

  it("POST restore 409 stash_conflict with files; tree clean, stash kept", async () => {
    const { repo, project, sha } = await stashedProject();
    writeRepoFile(repo, "README.md", "# base side\n");
    git(repo, "commit", "-q", "-am", "chore: base edit");
    const r = await call("POST", `/api/projects/${project.id}/stashes/${sha}/restore`);
    expect(r).toEqual({ status: 409, json: { error: "stash_conflict", files: ["README.md"] } });
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(existsSync(join(repo, "stray.txt"))).toBe(false);
    expect((await call("GET", `/api/projects/${project.id}/stashes`)).json!.stashes.map((s: any) => s.ref)).toEqual([sha]);
  });

  it("POST restore 409 worktree_dirty; nothing changes", async () => {
    const { repo, project, sha } = await stashedProject();
    writeRepoFile(repo, "new-work.txt", "new\n");
    const r = await call("POST", `/api/projects/${project.id}/stashes/${sha}/restore`);
    expect(r).toEqual({ status: 409, json: { error: "worktree_dirty" } });
    expect(git(repo, "status", "--porcelain")).toBe("?? new-work.txt");
    expect(git(repo, "rev-parse", "stash@{0}")).toBe(sha);
  });

  it("409 repo_busy while the repo lock is held (restore and drop never wait)", async () => {
    const { repo, project, sha } = await stashedProject();
    const lease = await acquireRepoLock(repo, { owner: "task:other:tok" });
    try {
      expect(await call("POST", `/api/projects/${project.id}/stashes/${sha}/restore`)).toEqual({
        status: 409,
        json: { error: "repo_busy" },
      });
      expect(await call("DELETE", `/api/projects/${project.id}/stashes/${sha}`)).toEqual({
        status: 409,
        json: { error: "repo_busy" },
      });
    } finally {
      lease.release();
    }
    expect(git(repo, "rev-parse", "stash@{0}")).toBe(sha);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("DELETE 204, then 404 stash_not_found", async () => {
    const { repo, project, sha } = await stashedProject();
    expect(await call("DELETE", `/api/projects/${project.id}/stashes/${sha}`)).toEqual({ status: 204, json: null });
    expect(git(repo, "stash", "list")).toBe("");
    expect(await call("DELETE", `/api/projects/${project.id}/stashes/${sha}`)).toEqual({
      status: 404,
      json: { error: "stash_not_found" },
    });
  });

  it("an invalid :ref is 400 invalid_body", async () => {
    const { project } = await stashedProject();
    for (const ref of ["stash@{0}", "abc123", "z".repeat(40)]) {
      const restore = await call("POST", `/api/projects/${project.id}/stashes/${encodeURIComponent(ref)}/restore`);
      expect(restore.status).toBe(400);
      expect(restore.json!.error).toBe("invalid_body");
      const drop = await call("DELETE", `/api/projects/${project.id}/stashes/${encodeURIComponent(ref)}`);
      expect(drop.status).toBe(400);
      expect(drop.json!.error).toBe("invalid_body");
    }
  });
});

describe("stash_created event (plan §3/28, §5.7)", () => {
  it("fires once each for a run, a local merge and a comment in a dirty repo", async () => {
    // Run: a dirty tree is stashed by checkoutBase.
    const a = await makeTeamCase({
      project: { defaultTeamId: null },
      setupRepo: (repo) => writeRepoFile(repo, "scratch.txt", "user edit\n"),
    });
    const ran = await runTeamCase(a, { uiLang: "en" });
    expect(ran.status).toBe("review");
    expect(stashSpy).toHaveBeenCalledTimes(1);

    // Local merge (Review → Done) with a dirty tree.
    writeRepoFile(a.repo, "scratch2.txt", "another edit\n");
    const merged = await call("PATCH", `/api/tasks/${a.task.id}`, { status: "done" });
    expect(merged.status).toBe(200);
    expect(stashSpy).toHaveBeenCalledTimes(2);

    // Comment: a failing run leaves edits that go to a stash.
    const b = await makeTeamCase({ scenario: "exit_error", project: { defaultTeamId: null } });
    const branch = "feature/clf-1-review";
    git(b.repo, "checkout", "-q", "-b", branch);
    writeFileSync(join(b.repo, "work.txt"), "work\n");
    git(b.repo, "add", "-A");
    git(b.repo, "commit", "-q", "-m", "feat: work");
    git(b.repo, "checkout", "-q", "main");
    await updateTask(b.task.id, { status: "review", branch });
    const comment = createComment(b.task.id, "break it");
    await runComment(comment, b.project);
    expect(getComment(comment.id)!.status).toBe("error");

    expect(stashSpy).toHaveBeenCalledTimes(3);
    const calls = stashSpy.mock.calls as Array<[string | null, Record<string, unknown>]>;
    expect(calls.map(([, p]) => p.reason)).toEqual(["run", "merge", "comment"]);
    expect(calls.map(([id]) => id)).toEqual([a.task.id, a.task.id, b.task.id]);

    const aTask = (await getTask(a.task.id))!;
    expect(calls[0]![1]).toEqual({
      projectId: a.project.id,
      label: expect.stringMatching(new RegExp(`^kanban-auto-${a.task.id}-`)),
      reason: "run",
      displayId: aTask.displayId ?? null,
    });
    expect(calls[1]![1]).toEqual({
      projectId: a.project.id,
      label: `clauflow-merge-${a.task.id}`,
      reason: "merge",
      displayId: aTask.displayId ?? null,
    });
    expect(calls[2]![1]).toMatchObject({
      projectId: b.project.id,
      label: `clauflow-comment-${comment.id}`,
      reason: "comment",
    });
    expect(git(a.repo, "stash", "list")).toContain(`clauflow-merge-${a.task.id}`);
    expect(git(b.repo, "stash", "list")).toContain(`clauflow-comment-${comment.id}`);
  });
});
