import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-delparent-${process.pid}-${Date.now()}`;
});

const exec = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("../agents/executor.js", () => ({
  enqueue: (task: { id: string }) => exec.enqueued.push(task.id),
  abort: () => false,
  isRunning: () => false,
  runPhase: () => null,
  waitForIdle: async () => {},
}));

const ws = vi.hoisted(() => ({ updated: [] as string[], deleted: [] as string[] }));
vi.mock("../services/wsService.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/wsService.js")>();
  return {
    ...orig,
    broadcastTaskUpdated: (task: { id: string }) => {
      ws.updated.push(task.id);
    },
    broadcastTaskDeleted: (id: string) => {
      ws.deleted.push(id);
    },
  };
});

import { rmSync } from "node:fs";
import { createProject, createTask, db, deleteProject, getTask, listTasks } from "../services/taskService.js";
import { makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import tasksRouter from "./tasks.js";

/** bakim #11 (plan §3/5–7, §5.1b): a broken-down parent can be deleted; its children live on. */

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
  const repo = makeRepo("clauflow-delparent-");
  dirs.push(repo);
  const project = await createProject({
    name: `dp ${dirs.length}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `dp${dirs.length}${Date.now().toString(36)}`,
  });
  const parent = await createTask({ projectId: project.id, title: "Parent" });
  const c1 = await createTask({ projectId: project.id, title: "Child 1", parentTaskId: parent.id, priority: "high" });
  const c2 = await createTask({ projectId: project.id, title: "Child 2", parentTaskId: parent.id, tags: ["x"] });
  return { repo, project, parent, c1, c2 };
}

const edgesOf = (id: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM task_dependencies WHERE taskId = ? OR dependsOnId = ?`).get(id, id) as { n: number }).n;

beforeAll(async () => {
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

beforeEach(() => {
  exec.enqueued.length = 0;
  ws.updated.length = 0;
  ws.deleted.length = 0;
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("DELETE a broken-down parent (bakim #11)", () => {
  it("204; both children survive with parentTaskId = null and everything else unchanged", async () => {
    const { parent, c1, c2 } = await setup();
    const before1 = (await getTask(c1.id))!;
    const before2 = (await getTask(c2.id))!;
    expect(before1.parentTaskId).toBe(parent.id);

    const r = await call("DELETE", `/api/tasks/${parent.id}`);
    expect(r.status).toBe(204);
    expect(await getTask(parent.id)).toBeNull();

    const after1 = (await getTask(c1.id))!;
    const after2 = (await getTask(c2.id))!;
    expect(after1.parentTaskId).toBeNull();
    expect(after2.parentTaskId).toBeNull();
    const strip = (t: Record<string, unknown>) => {
      const { parentTaskId: _p, updatedAt: _u, ...rest } = t;
      return rest;
    };
    expect(strip(after1 as never)).toEqual(strip(before1 as never));
    expect(strip(after2 as never)).toEqual(strip(before2 as never));
    expect(ws.deleted).toEqual([parent.id]);
    expect(ws.updated.sort()).toEqual([c1.id, c2.id].sort());
  });

  it("the parent's dependency edges go; a fan-in dependent (parent + both children) is not started", async () => {
    const { project, parent, c1, c2 } = await setup();
    const dep = await createTask({ projectId: project.id, title: "Dependent", dependsOn: [parent.id, c1.id, c2.id] });
    const wait = await call("PATCH", `/api/tasks/${dep.id}`, { status: "doing", uiLang: "en" });
    expect(wait.json.task.agent.status).toBe("waiting_deps");
    expect(edgesOf(parent.id)).toBe(1);

    const r = await call("DELETE", `/api/tasks/${parent.id}`);
    expect(r.status).toBe(204);
    expect(edgesOf(parent.id)).toBe(0);
    await new Promise((res) => setTimeout(res, 50));
    const after = (await getTask(dep.id))!;
    expect(after.status).toBe("doing");
    expect(after.agent.status).toBe("waiting_deps");
    expect(after.dependsOn.sort()).toEqual([c1.id, c2.id].sort());
    expect(exec.enqueued).toEqual([]);
  });

  it("a missing task is 404 not_found", async () => {
    const r = await call("DELETE", `/api/tasks/task_doesnotexist`);
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("not_found");
  });

  it("a childless task deletes as before (204, no task_updated)", async () => {
    const { c1 } = await setup();
    const r = await call("DELETE", `/api/tasks/${c1.id}`);
    expect(r.status).toBe(204);
    expect(await getTask(c1.id)).toBeNull();
    expect(ws.updated).toEqual([]);
    expect(ws.deleted).toEqual([c1.id]);
  });

  it("deleteProject removes a project that holds a parent with children (no FK error, unchanged)", async () => {
    const { project, parent } = await setup();
    await expect(deleteProject(project.id)).resolves.toBeUndefined();
    expect(await getTask(parent.id)).toBeNull();
    expect((await listTasks(project.id)).length).toBe(0);
  });
});
