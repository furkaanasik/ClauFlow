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

describe("stash files + diff (bakim #6, §3/16–17)", () => {
  const enc = encodeURIComponent;

  it("GET files: detail of the stash (summary, code files, untracked as U)", async () => {
    const { project, sha, label } = await stashedProject();
    const r = await call("GET", `/api/projects/${project.id}/stashes/${sha}/files`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      ref: sha,
      label,
      summary: { total: 2, code: 2, untracked: 1, deps: 0, build: 0, lockOs: 0 },
      safeToDrop: false,
      codeFiles: [
        { path: "README.md", status: "M", class: "code" },
        { path: "stray.txt", status: "U", class: "code" },
      ],
      lockOsFiles: [],
      groups: [],
      truncated: false,
    });
    const list = await call("GET", `/api/projects/${project.id}/stashes`);
    expect(list.json!.stashes[0]).toMatchObject({ summary: { total: 2, code: 2 }, safeToDrop: false });
  });

  it("GET diff: a tracked file has a diff --git header; an untracked one is a new file", async () => {
    const { project, sha } = await stashedProject();
    const tracked = await call("GET", `/api/projects/${project.id}/stashes/${sha}/diff?path=README.md`);
    expect(tracked.status).toBe(200);
    expect(tracked.json).toMatchObject({ path: "README.md", status: "M", truncated: false });
    expect(tracked.json!.diff).toMatch(/^diff --git a\/README\.md b\/README\.md/);
    expect(tracked.json!.diff).toContain("+# stashed side");

    const untracked = await call("GET", `/api/projects/${project.id}/stashes/${sha}/diff?path=stray.txt`);
    expect(untracked.status).toBe(200);
    expect(untracked.json).toMatchObject({ path: "stray.txt", status: "U" });
    expect(untracked.json!.diff).toContain("new file mode");
    expect(untracked.json!.diff).toContain("+untracked");
  });

  it("GET diff: a path not in the stash, .. or an absolute path → 404 stash_file_not_found", async () => {
    const { project, sha } = await stashedProject();
    for (const p of ["other.txt", "../README.md", "/etc/passwd", "./README.md", ":(top)README.md"]) {
      const r = await call("GET", `/api/projects/${project.id}/stashes/${sha}/diff?path=${enc(p)}`);
      expect(r).toEqual({ status: 404, json: { error: "stash_file_not_found" } });
    }
    const missing = await call("GET", `/api/projects/${project.id}/stashes/${sha}/diff`);
    expect(missing.status).toBe(400);
  });

  it("a stash without a ClauFlow label is 404 stash_not_found for files and diff", async () => {
    const { repo, project } = await stashedProject();
    writeRepoFile(repo, "mine.txt", "user\n");
    git(repo, "stash", "push", "-u", "-m", "mine");
    const mine = git(repo, "rev-parse", "stash@{0}");
    expect(await call("GET", `/api/projects/${project.id}/stashes/${mine}/files`)).toEqual({
      status: 404,
      json: { error: "stash_not_found" },
    });
    expect(await call("GET", `/api/projects/${project.id}/stashes/${mine}/diff?path=mine.txt`)).toEqual({
      status: 404,
      json: { error: "stash_not_found" },
    });
  });

  it("GET diff over DIFF_CHAR_CAP is cut and flagged truncated", async () => {
    const { repo, project } = await stashedProject();
    writeRepoFile(repo, "big.txt", `${"x".repeat(99)}\n`.repeat(2_500)); // 250 000 chars
    git(repo, "stash", "push", "-u", "-m", "clauflow-merge-task_big");
    const big = git(repo, "rev-parse", "stash@{0}");
    const r = await call("GET", `/api/projects/${project.id}/stashes/${big}/diff?path=big.txt`);
    expect(r.status).toBe(200);
    expect(r.json!.truncated).toBe(true);
    expect(r.json!.diff.length).toBe(200_000);
  });
});

describe("POST restore-file (bakim #6, §3/18)", () => {
  const restoreFile = (projectId: string, sha: string, path: string) =>
    call("POST", `/api/projects/${projectId}/stashes/${sha}/restore-file`, { path });

  it("a tracked file comes back with the stash's content; the index is untouched and the stash stays", async () => {
    const { repo, project, sha } = await stashedProject();
    const r = await restoreFile(project.id, sha, "README.md");
    expect(r).toEqual({ status: 200, json: { restored: "README.md", branch: "main" } });
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# stashed side\n");
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
    expect(git(repo, "status", "--porcelain")).toBe("M README.md");
    expect(existsSync(join(repo, "stray.txt"))).toBe(false);
    expect(git(repo, "rev-parse", "stash@{0}")).toBe(sha);
  });

  it("an untracked file comes back as untracked (??)", async () => {
    const { repo, project, sha } = await stashedProject();
    const r = await restoreFile(project.id, sha, "stray.txt");
    expect(r.status).toBe(200);
    expect(readFileSync(join(repo, "stray.txt"), "utf8")).toBe("untracked\n");
    expect(git(repo, "status", "--porcelain")).toBe("?? stray.txt");
    expect(git(repo, "rev-parse", "stash@{0}")).toBe(sha);
  });

  it("the same path dirty → 409 worktree_dirty + files; another dirty file does not block it", async () => {
    const { repo, project, sha } = await stashedProject();
    writeRepoFile(repo, "README.md", "# my newer edit\n");
    expect(await restoreFile(project.id, sha, "README.md")).toEqual({
      status: 409,
      json: { error: "worktree_dirty", files: ["README.md"] },
    });
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# my newer edit\n");

    writeRepoFile(repo, "other.txt", "busy elsewhere\n");
    const ok = await restoreFile(project.id, sha, "stray.txt");
    expect(ok.status).toBe(200);
    expect(readFileSync(join(repo, "stray.txt"), "utf8")).toBe("untracked\n");
    expect(readFileSync(join(repo, "other.txt"), "utf8")).toBe("busy elsewhere\n");
  });

  it("a deleted (D) file → 422 stash_file_deleted; an unknown path → 404 stash_file_not_found", async () => {
    const { repo, project } = await stashedProject();
    writeRepoFile(repo, "gone.txt", "tracked\n");
    git(repo, "add", "gone.txt");
    git(repo, "commit", "-q", "-m", "gone");
    rmSync(join(repo, "gone.txt"));
    git(repo, "stash", "push", "-u", "-m", "clauflow-merge-task_del");
    const del = git(repo, "rev-parse", "stash@{0}");
    expect(await restoreFile(project.id, del, "gone.txt")).toEqual({
      status: 422,
      json: { error: "stash_file_deleted" },
    });
    expect(readFileSync(join(repo, "gone.txt"), "utf8")).toBe("tracked\n");
    expect(await restoreFile(project.id, del, "nope.txt")).toEqual({
      status: 404,
      json: { error: "stash_file_not_found" },
    });
  });

  it("409 repo_busy while the repo lock is held", async () => {
    const { repo, project, sha } = await stashedProject();
    const lease = await acquireRepoLock(repo, { owner: "task:other:tok" });
    try {
      expect(await restoreFile(project.id, sha, "README.md")).toEqual({ status: 409, json: { error: "repo_busy" } });
    } finally {
      lease.release();
    }
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("a path that collides with a folder (or a file where its folder goes) → 409 stash_conflict, nothing changes", async () => {
    const { repo, project } = await stashedProject();
    writeRepoFile(repo, "conf", "file in the stash\n");
    writeRepoFile(repo, "lib/b.txt", "nested in the stash\n");
    git(repo, "stash", "push", "-u", "-m", "clauflow-merge-task_df");
    const df = git(repo, "rev-parse", "stash@{0}");
    // Base moves on: `conf` becomes a folder, `lib` a file.
    writeRepoFile(repo, "conf/a.txt", "tracked folder\n");
    writeRepoFile(repo, "lib", "tracked file\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "d/f");
    const head = git(repo, "rev-parse", "HEAD");

    expect(await restoreFile(project.id, df, "conf")).toEqual({
      status: 409,
      json: { error: "stash_conflict", files: ["conf"] },
    });
    expect(await restoreFile(project.id, df, "lib/b.txt")).toEqual({
      status: 409,
      json: { error: "stash_conflict", files: ["lib/b.txt"] },
    });
    expect(readFileSync(join(repo, "conf", "a.txt"), "utf8")).toBe("tracked folder\n");
    expect(readFileSync(join(repo, "lib"), "utf8")).toBe("tracked file\n");
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo, "rev-parse", "stash@{0}")).toBe(df);
  });

  it("an ignored copy on disk counts as dirty (it would be overwritten)", async () => {
    const { repo, project } = await stashedProject();
    writeRepoFile(repo, "node_modules/x/index.js", "stashed\n");
    git(repo, "stash", "push", "-u", "-m", "clauflow-merge-task_ign");
    const ign = git(repo, "rev-parse", "stash@{0}");
    writeFileSync(join(repo, ".git", "info", "exclude"), "/node_modules/\n");
    writeRepoFile(repo, "node_modules/x/index.js", "installed later\n");
    expect(await restoreFile(project.id, ign, "node_modules/x/index.js")).toEqual({
      status: 409,
      json: { error: "worktree_dirty", files: ["node_modules/x/index.js"] },
    });
    expect(readFileSync(join(repo, "node_modules", "x", "index.js"), "utf8")).toBe("installed later\n");
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
