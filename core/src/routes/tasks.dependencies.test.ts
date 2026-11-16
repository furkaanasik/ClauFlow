import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-taskdeps-${process.pid}-${Date.now()}`;
});

const exec = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("../agents/executor.js", () => ({
  enqueue: (task: { id: string }) => exec.enqueued.push(task.id),
  abort: () => false,
  isRunning: () => false,
  runPhase: () => null,
  waitForIdle: async () => {},
}));

const ws = vi.hoisted(() => ({ updated: [] as Array<{ id: string; dependsOn: string[] }> }));
vi.mock("../services/wsService.js", async (orig) => {
  const real = await orig<typeof import("../services/wsService.js")>();
  return {
    ...real,
    broadcastTaskUpdated: (task: { id: string; dependsOn: string[] }) => {
      ws.updated.push({ id: task.id, dependsOn: task.dependsOn });
    },
  };
});

import { rmSync } from "node:fs";
import { createProject, createTask, updateTask } from "../services/taskService.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import tasksRouter from "./tasks.js";

let server: TestServer;
let n = 0;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function project() {
  n += 1;
  return createProject({
    name: `td ${n}`,
    repoPath: `/tmp/clauflow-taskdeps-repo-${n}`,
    slug: `td${n}${Date.now().toString(36)}`,
  });
}

async function pair() {
  const p = await project();
  const a = await createTask({ projectId: p.id, title: "A" });
  const b = await createTask({ projectId: p.id, title: "B" });
  return { p, a, b };
}

beforeAll(async () => {
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

beforeEach(() => {
  exec.enqueued.length = 0;
  ws.updated.length = 0;
});

afterAll(async () => {
  await server.close();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("PUT /api/tasks/:id/dependencies (zincir F1)", () => {
  it("200 + task; GET and the project list carry dependsOn; task_updated is broadcast", async () => {
    const { p, a, b } = await pair();
    const r = await call("PUT", `/api/tasks/${b.id}/dependencies`, { dependsOn: [a.id] });
    expect(r.status).toBe(200);
    expect(r.json.task.dependsOn).toEqual([a.id]);
    expect(ws.updated).toEqual([{ id: b.id, dependsOn: [a.id] }]);

    const g = await call("GET", `/api/tasks/${b.id}`);
    expect(g.json.task.dependsOn).toEqual([a.id]);
    const list = await call("GET", `/api/tasks?projectId=${p.id}`);
    const byId = Object.fromEntries((list.json.tasks as any[]).map((t) => [t.id, t.dependsOn]));
    expect(byId).toEqual({ [a.id]: [], [b.id]: [a.id] });
    expect(exec.enqueued).toEqual([]);
  });

  it("409 dependency_cycle with the displayId path", async () => {
    const { a, b } = await pair();
    expect((await call("PUT", `/api/tasks/${b.id}/dependencies`, { dependsOn: [a.id] })).status).toBe(200);
    const r = await call("PUT", `/api/tasks/${a.id}/dependencies`, { dependsOn: [b.id] });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "dependency_cycle", path: [a.displayId, b.displayId, a.displayId] });
  });

  it("400 dependency_self and dependency_cross_project", async () => {
    const { a } = await pair();
    const other = await pair();
    const self = await call("PUT", `/api/tasks/${a.id}/dependencies`, { dependsOn: [a.id] });
    expect(self.status).toBe(400);
    expect(self.json.error).toBe("dependency_self");
    const cross = await call("PUT", `/api/tasks/${a.id}/dependencies`, { dependsOn: [other.a.id] });
    expect(cross.status).toBe(400);
    expect(cross.json.error).toBe("dependency_cross_project");
  });

  it("404 for an unknown dependency and for an unknown task", async () => {
    const { a } = await pair();
    const dep = await call("PUT", `/api/tasks/${a.id}/dependencies`, { dependsOn: ["task_nope"] });
    expect(dep.status).toBe(404);
    expect(dep.json).toEqual({ error: "dependency_not_found", id: "task_nope" });
    const task = await call("PUT", `/api/tasks/task_nope/dependencies`, { dependsOn: [a.id] });
    expect(task.status).toBe(404);
    expect(task.json.error).toBe("not_found");
  });

  it("409 dependencies_locked on a task in review; nothing changes", async () => {
    const { a, b } = await pair();
    await updateTask(b.id, { status: "review" });
    const r = await call("PUT", `/api/tasks/${b.id}/dependencies`, { dependsOn: [a.id] });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("dependencies_locked");
    expect((await call("GET", `/api/tasks/${b.id}`)).json.task.dependsOn).toEqual([]);
    expect(ws.updated).toEqual([]);
  });

  it("400 invalid_body for a malformed body or more than 20 ids", async () => {
    const { a } = await pair();
    expect((await call("PUT", `/api/tasks/${a.id}/dependencies`, { dependsOn: "x" })).json.error).toBe("invalid_body");
    const many = Array.from({ length: 21 }, (_, i) => `task_${i}`);
    expect((await call("PUT", `/api/tasks/${a.id}/dependencies`, { dependsOn: many })).status).toBe(400);
  });
});

describe("POST /api/tasks with dependsOn and DELETE (zincir F1)", () => {
  it("creates a task with its dependencies", async () => {
    const { p, a, b } = await pair();
    const r = await call("POST", `/api/tasks`, { projectId: p.id, title: "C", dependsOn: [b.id, a.id] });
    expect(r.status).toBe(201);
    expect(r.json.task.dependsOn).toEqual([a.id, b.id]);
  });

  it("rejects an unknown or cross-project dependency on create", async () => {
    const { p } = await pair();
    const other = await pair();
    const nf = await call("POST", `/api/tasks`, { projectId: p.id, title: "C", dependsOn: ["task_nope"] });
    expect(nf.status).toBe(404);
    expect(nf.json.error).toBe("dependency_not_found");
    const cross = await call("POST", `/api/tasks`, { projectId: p.id, title: "C", dependsOn: [other.a.id] });
    expect(cross.status).toBe(400);
    expect(cross.json.error).toBe("dependency_cross_project");
  });

  it("DELETE of the dependency empties the dependent's dependsOn", async () => {
    const { a, b } = await pair();
    await call("PUT", `/api/tasks/${b.id}/dependencies`, { dependsOn: [a.id] });
    expect((await call("DELETE", `/api/tasks/${a.id}`)).status).toBe(204);
    expect((await call("GET", `/api/tasks/${b.id}`)).json.task.dependsOn).toEqual([]);
  });
});
