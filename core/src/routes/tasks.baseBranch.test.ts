import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-taskbase-${stamp}`;
});

const exec = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("../agents/executor.js", () => ({
  enqueue: (task: { id: string }) => exec.enqueued.push(task.id),
  abort: () => false,
  isRunning: () => false,
  runPhase: () => null,
  waitForIdle: async () => {},
}));

import { rmSync } from "node:fs";
import { createProject, createTask, getTask, updateTask } from "../services/taskService.js";
import { makeRepo } from "../test-utils/fakeRepo.js";
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
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

async function setup(defaultBranch: string) {
  const repo = makeRepo("clauflow-taskbase-");
  dirs.push(repo);
  const project = await createProject({
    name: `tb ${dirs.length}`,
    repoPath: repo,
    defaultBranch,
    slug: `tb${dirs.length}${Date.now().toString(36)}`,
  });
  const task = await createTask({ projectId: project.id, title: "x" });
  return { repo, project, task };
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

describe("PATCH doing / retry base-branch precheck (zincir F0.5, plan §5.0)", () => {
  it("PATCH doing with a missing base → 422 + current, task untouched, nothing queued", async () => {
    const { task } = await setup("master");
    const before = (await getTask(task.id))!;
    const r = await call("PATCH", `/api/tasks/${task.id}`, { status: "doing", uiLang: "en" });
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: "base_branch_missing", current: "main" });
    const after = (await getTask(task.id))!;
    expect(after.status).toBe("todo");
    expect(after.agent).toEqual(before.agent);
    expect(exec.enqueued).toEqual([]);
  });

  it("PATCH doing with the right base → 200 and the run is queued", async () => {
    const { task } = await setup("main");
    const r = await call("PATCH", `/api/tasks/${task.id}`, { status: "doing" });
    expect(r.status).toBe(200);
    expect(r.json.task.status).toBe("doing");
    expect(exec.enqueued).toEqual([task.id]);
  });

  it("a non-status PATCH is not blocked by a missing base", async () => {
    const { task } = await setup("master");
    const r = await call("PATCH", `/api/tasks/${task.id}`, { title: "renamed" });
    expect(r.status).toBe(200);
    expect(r.json.task.title).toBe("renamed");
  });

  it("retry with a missing base → 422, task stays as it was, nothing queued", async () => {
    const { task } = await setup("master");
    await updateTask(task.id, { status: "doing", agent: { status: "error", error: "x" } });
    const r = await call("POST", `/api/tasks/${task.id}/retry`, {});
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ error: "base_branch_missing", current: "main" });
    const after = (await getTask(task.id))!;
    expect(after.agent.status).toBe("error");
    expect(after.agent.error).toBe("x");
    expect(exec.enqueued).toEqual([]);
  });

  it("retry with the right base → 200 and queued", async () => {
    const { task } = await setup("main");
    await updateTask(task.id, { status: "doing", agent: { status: "error", error: "x" } });
    const r = await call("POST", `/api/tasks/${task.id}/retry`, {});
    expect(r.status).toBe(200);
    expect(exec.enqueued).toEqual([task.id]);
  });
});
