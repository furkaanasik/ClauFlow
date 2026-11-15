import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-taskchain-${process.pid}-${Date.now()}`;
});

const exec = vi.hoisted(() => ({ enqueued: [] as Array<{ id: string; uiLang: string | undefined }> }));
vi.mock("../agents/executor.js", () => ({
  enqueue: (task: { id: string }, _p: unknown, opts: { uiLang?: string } = {}) =>
    exec.enqueued.push({ id: task.id, uiLang: opts.uiLang }),
  abort: () => false,
  isRunning: () => false,
  runPhase: () => null,
  waitForIdle: async () => {},
}));

import { rmSync } from "node:fs";
import { createProject, createTask, db, getTask, updateTask } from "../services/taskService.js";
import { listTeamRunsByTask } from "../services/teamRunService.js";
import { getRepoLockHolder, getRepoLockQueue } from "../services/repoLock.js";
import { git, makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import tasksRouter from "./tasks.js";

let server: TestServer;
const dirs: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function setup() {
  const repo = makeRepo("clauflow-taskchain-");
  dirs.push(repo);
  const project = await createProject({
    name: `tc ${dirs.length}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `tc${dirs.length}${Date.now().toString(36)}`,
  });
  const a = await createTask({ projectId: project.id, title: "A" });
  const b = await createTask({ projectId: project.id, title: "B", dependsOn: [a.id] });
  return { repo, project, a, b };
}

function gitState(repo: string) {
  return {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
    branches: git(repo, "branch", "--list"),
    stash: git(repo, "stash", "list"),
    status: git(repo, "status", "--porcelain"),
  };
}

beforeAll(async () => {
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

beforeEach(() => {
  exec.enqueued.length = 0;
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("PATCH doing gate (zincir F2, plan §3/5)", () => {
  it("B waits for A: 200 waiting_deps, nothing queued, no repo lock held or queued", async () => {
    const { repo, b } = await setup();
    const r = await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", uiLang: "en" });
    expect(r.status).toBe(200);
    expect(r.json.task.status).toBe("doing");
    expect(r.json.task.agent.status).toBe("waiting_deps");
    expect(exec.enqueued).toEqual([]);
    expect(getRepoLockHolder(repo)).toBeNull();
    expect(getRepoLockQueue(repo)).toEqual([]);
  });

  it("A without dependencies starts normally (idle + queued)", async () => {
    const { a } = await setup();
    const r = await call("PATCH", `/api/tasks/${a.id}`, { status: "doing", uiLang: "tr" });
    expect(r.status).toBe(200);
    expect(r.json.task.agent.status).toBe("idle");
    expect(exec.enqueued).toEqual([{ id: a.id, uiLang: "tr" }]);
  });

  it("other fields in the same PATCH are kept", async () => {
    const { b } = await setup();
    const r = await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", title: "B renamed" });
    expect(r.json.task.title).toBe("B renamed");
    expect(r.json.task.agent.status).toBe("waiting_deps");
  });
});

describe("abort a waiting task (zincir F2, plan §3/10)", () => {
  it("todo + aborted_while_waiting; git untouched; no team run rows", async () => {
    const { repo, b } = await setup();
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing" });
    const before = gitState(repo);
    const r = await call("POST", `/api/tasks/${b.id}/abort`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ aborted: true, source: "waiting" });
    const after = (await getTask(b.id))!;
    expect(after.status).toBe("todo");
    expect(after.agent.status).toBe("error");
    expect(after.agent.error).toBe("aborted_while_waiting");
    expect(gitState(repo)).toEqual(before);
    expect(listTeamRunsByTask(b.id)).toEqual([]);
    expect(exec.enqueued).toEqual([]);
  });
});

describe("waiting task starts when nothing is unmet any more (zincir F2, plan §5.3)", () => {
  it("PUT dependencies removing the only dependency starts it", async () => {
    const { b } = await setup();
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", uiLang: "en" });
    const r = await call("PUT", `/api/tasks/${b.id}/dependencies`, { dependsOn: [] });
    expect(r.status).toBe(200);
    expect(r.json.task.agent.status).toBe("idle");
    expect(r.json.task.dependsOn).toEqual([]);
    expect(exec.enqueued).toEqual([{ id: b.id, uiLang: "en" }]);
  });

  it("PUT dependencies keeping an unmet one leaves it waiting", async () => {
    const { project, b } = await setup();
    const c = await createTask({ projectId: project.id, title: "C" });
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing" });
    const r = await call("PUT", `/api/tasks/${b.id}/dependencies`, { dependsOn: [c.id] });
    expect(r.json.task.agent.status).toBe("waiting_deps");
    expect(exec.enqueued).toEqual([]);
  });

  it("deleting A starts B", async () => {
    const { a, b } = await setup();
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", uiLang: "tr" });
    expect((await call("DELETE", `/api/tasks/${a.id}`)).status).toBe(204);
    await vi.waitFor(() => expect(exec.enqueued).toEqual([{ id: b.id, uiLang: "tr" }]));
    const fresh = (await getTask(b.id))!;
    expect(fresh.agent.status).toBe("idle");
    expect(fresh.dependsOn).toEqual([]);
  });

  it("deleting one of two dependencies keeps it waiting", async () => {
    const { project, a, b } = await setup();
    const c = await createTask({ projectId: project.id, title: "C" });
    await call("PUT", `/api/tasks/${b.id}/dependencies`, { dependsOn: [a.id, c.id] });
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing" });
    await call("DELETE", `/api/tasks/${a.id}`);
    await new Promise((r) => setTimeout(r, 30));
    expect(exec.enqueued).toEqual([]);
    const fresh = (await getTask(b.id))!;
    expect(fresh.agent.status).toBe("waiting_deps");
    expect(fresh.dependsOn).toEqual([c.id]);
  });
});

describe("/retry passes the gate (zincir F2)", () => {
  it("a waiting task stays waiting; nothing queued", async () => {
    const { b } = await setup();
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing" });
    const r = await call("POST", `/api/tasks/${b.id}/retry`, { uiLang: "en" });
    expect(r.status).toBe(200);
    expect(r.json.task.agent.status).toBe("waiting_deps");
    expect(exec.enqueued).toEqual([]);
  });

  it("a failed doing task whose dependency is not done goes back to waiting", async () => {
    const { b } = await setup();
    // A crashed run left B in doing/error (e.g. its dependency was moved back after it started).
    db.prepare(`UPDATE tasks SET status = 'doing', agentStatus = 'error', agentError = 'x' WHERE id = ?`).run(b.id);
    const r = await call("POST", `/api/tasks/${b.id}/retry`, {});
    expect(r.json.task.agent.status).toBe("waiting_deps");
    expect(r.json.task.agent.error).toBeNull();
    expect(exec.enqueued).toEqual([]);
  });

  it("a doing task whose dependency is done is queued", async () => {
    const { a, b } = await setup();
    await updateTask(a.id, { status: "done" });
    db.prepare(`UPDATE tasks SET status = 'doing', agentStatus = 'error' WHERE id = ?`).run(b.id);
    const r = await call("POST", `/api/tasks/${b.id}/retry`, { uiLang: "tr" });
    expect(r.json.task.agent.status).toBe("idle");
    expect(exec.enqueued).toEqual([{ id: b.id, uiLang: "tr" }]);
  });
});

describe("POST /:id/start-waiting (zincir F2, plan §3/25)", () => {
  it("a ready waiting task starts once; a second call is 409 not_waiting", async () => {
    const { a, b } = await setup();
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", uiLang: "en" });
    // Crash window: the dependency is done but the trigger never ran.
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(a.id);
    const r = await call("POST", `/api/tasks/${b.id}/start-waiting`);
    expect(r.status).toBe(200);
    expect(r.json.task.agent.status).toBe("idle");
    expect(exec.enqueued).toEqual([{ id: b.id, uiLang: "en" }]);
    const again = await call("POST", `/api/tasks/${b.id}/start-waiting`);
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("not_waiting");
    expect(exec.enqueued).toHaveLength(1);
  });

  it("a waiting task with an unmet dependency → 409 dependencies_unmet + displayIds", async () => {
    const { a, b } = await setup();
    await call("PATCH", `/api/tasks/${b.id}`, { status: "doing" });
    const r = await call("POST", `/api/tasks/${b.id}/start-waiting`);
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "dependencies_unmet", unmet: [a.displayId] });
    expect(exec.enqueued).toEqual([]);
  });

  it("a todo task → 409 not_waiting; unknown task → 404", async () => {
    const { a } = await setup();
    const r = await call("POST", `/api/tasks/${a.id}/start-waiting`);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("not_waiting");
    expect((await call("POST", `/api/tasks/task_nope/start-waiting`)).status).toBe(404);
    expect(exec.enqueued).toEqual([]);
  });
});
