import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-taskmerge-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-taskmerge-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { __setResolvingForTest, resolverRuntime } from "../agents/conflictResolver.js";
import { tryAcquireRepoLock } from "../services/repoLock.js";
import { createProject, createTask, getTask, updateTask } from "../services/taskService.js";
import { addBareOrigin, installFakeGh } from "../test-utils/fakeGh.js";
import { git, makeRepo, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import githubRouter from "./github.js";
import tasksRouter from "./tasks.js";

let server: TestServer;
const dirs: string[] = [];
const BRANCH = "feature/clf-2-y";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function setup(opts: { status?: "review" | "todo"; conflict?: boolean; remote?: boolean } = {}) {
  const repo = makeRepo("clauflow-taskmerge-");
  dirs.push(repo);
  if (opts.remote) dirs.push(addBareOrigin(repo));
  git(repo, "checkout", "-q", "-b", BRANCH);
  writeRepoFile(repo, opts.conflict ? "README.md" : "y.txt", "branch\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat: y");
  git(repo, "checkout", "-q", "main");
  if (opts.conflict) {
    writeRepoFile(repo, "README.md", "base\n");
    git(repo, "commit", "-q", "-am", "chore: base");
  }
  const project = await createProject({
    name: `tm ${dirs.length}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `tm${dirs.length}${Date.now().toString(36)}`,
  });
  const created = await createTask({ projectId: project.id, title: "y" });
  const task = await updateTask(created.id, { status: opts.status ?? "review", branch: BRANCH });
  return { repo, project, task };
}

beforeAll(async () => {
  server = await startTestServer([
    ["/api/tasks", tasksRouter],
    ["/api/github", githubRouter],
  ]);
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("PATCH /tasks/:id review → done (plan §5.2)", () => {
  it("merges locally before answering: 200, done, branch null, merge commit on main", async () => {
    const { repo, task } = await setup();
    const r = await call("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    expect(r.status).toBe(200);
    expect(r.json.task).toMatchObject({ status: "done", branch: null });
    expect(r.json.task.agent).toMatchObject({ status: "done", error: null });
    expect(git(repo, "log", "--merges", "-1", "--format=%s")).toBe(`Merge ${BRANCH} (${task.displayId ?? task.id})`);
    expect(git(repo, "branch", "--list", BRANCH)).toBe("");
    expect((await getTask(task.id))!.agent.log.some((l) => l.startsWith(`✓ Merged ${BRANCH} into main`))).toBe(true);
  });

  it("conflict: 409 merge_conflict with files, task stays in review (resolver queued, zincir F4.6), branch kept", async () => {
    const { repo, task } = await setup({ conflict: true });
    // zincir F4.6 (§3/32): the first conflict queues the AI resolver. Stub the
    // run (no CLI here): it ends the way a failed run would.
    let open!: () => void;
    const gate = new Promise<void>((res) => (open = res));
    const start = vi.spyOn(resolverRuntime, "startResolution").mockImplementation(async (id) => {
      await gate;
      __setResolvingForTest(id).release();
      await updateTask(id, { agent: { status: "error", currentStep: undefined, error: "conflict_unresolved:aborted" } });
    });
    const r = await call("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "merge_conflict", files: ["README.md"], resolving: true });
    const after = (await getTask(task.id))!;
    expect(after.status).toBe("review");
    expect(after.branch).toBe(BRANCH);
    expect(after.agent).toMatchObject({ status: "resolving_conflict", currentStep: "queued", error: null });
    expect(git(repo, "status", "--porcelain")).toBe("");
    for (let i = 0; i < 50 && start.mock.calls.length === 0; i++) await new Promise((res) => setTimeout(res, 10));
    expect(start).toHaveBeenCalledTimes(1);
    open();
    await vi.waitFor(async () => expect((await getTask(task.id))!.agent.status).toBe("error"));
    start.mockRestore();

    // Resolve on base by hand (take the branch side), then the retry merges.
    writeRepoFile(repo, "README.md", "branch\n");
    git(repo, "commit", "-q", "-am", "chore: resolve");
    const retry = await call("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    expect(retry.status).toBe(200);
    expect(retry.json.task.agent).toMatchObject({ status: "done", error: null });
  });

  it("repo busy: 409 repo_busy, nothing changes (no agent error for a transient lock)", async () => {
    const { repo, task } = await setup();
    const lease = tryAcquireRepoLock(repo, "comment:c1");
    try {
      const r = await call("PATCH", `/api/tasks/${task.id}`, { status: "done" });
      expect(r).toEqual({ status: 409, json: { error: "repo_busy" } });
      const after = (await getTask(task.id))!;
      expect(after.status).toBe("review");
      expect(after.agent.error ?? null).toBeNull();
    } finally {
      lease!.release();
    }
  });

  it("other → done moves (confirm dialog) never merge", async () => {
    const { repo, task } = await setup({ status: "todo" });
    const r = await call("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    expect(r.status).toBe(200);
    expect(r.json.task).toMatchObject({ status: "done", branch: BRANCH });
    expect(git(repo, "log", "--merges", "--oneline")).toBe("");
    expect(git(repo, "branch", "--list", BRANCH)).toContain(BRANCH);
  });
});

describe("POST /github/prs/:n/merge uses the same merge path", () => {
  it("merges via gh --delete-branch and closes the matching task", async () => {
    const gh = installFakeGh();
    try {
      const { project, task } = await setup({ remote: true });
      await updateTask(task.id, { prNumber: 5, prUrl: "https://github.com/acme/fake/pull/5" });
      const r = await call("POST", `/api/github/prs/5/merge?projectId=${project.id}`);
      expect(r).toEqual({ status: 200, json: { success: true } });
      expect(gh.calls()).toEqual(["pr merge 5 --merge --delete-branch"]);
      expect((await getTask(task.id))!).toMatchObject({ status: "done", branch: null });
    } finally {
      gh.restore();
    }
  });

  it("already merged → 409 pr_already_merged", async () => {
    const gh = installFakeGh();
    process.env.FAKE_GH_MERGE_FAIL = "Pull request #6 is already merged";
    try {
      const { project, task } = await setup({ remote: true });
      await updateTask(task.id, { prNumber: 6 });
      const r = await call("POST", `/api/github/prs/6/merge?projectId=${project.id}`);
      expect(r).toEqual({ status: 409, json: { error: "pr_already_merged" } });
      expect((await getTask(task.id))!.status).toBe("review");
    } finally {
      delete process.env.FAKE_GH_MERGE_FAIL;
      gh.restore();
    }
  });
});
