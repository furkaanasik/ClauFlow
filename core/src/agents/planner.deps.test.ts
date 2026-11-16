import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-plannerdeps-${process.pid}-${Date.now()}`;
});

const exec = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("./executor.js", () => ({
  enqueue: (task: { id: string }) => exec.enqueued.push(task.id),
  abort: () => false,
  isRunning: () => false,
  runPhase: () => null,
  waitForIdle: async () => {},
}));

const ws = vi.hoisted(() => ({
  created: [] as Array<{ id: string; title: string; dependsOn: string[] }>,
  updated: [] as Array<{ id: string; dependsOn: string[] }>,
}));
vi.mock("../services/wsService.js", async (orig) => {
  const real = await orig<typeof import("../services/wsService.js")>();
  return {
    ...real,
    broadcastTaskCreated: (t: { id: string; title: string; dependsOn: string[] }) =>
      ws.created.push({ id: t.id, title: t.title, dependsOn: [...t.dependsOn] }),
    broadcastTaskUpdated: (t: { id: string; dependsOn: string[] }) =>
      ws.updated.push({ id: t.id, dependsOn: [...t.dependsOn] }),
  };
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectPlanner } from "./projectPlanner.js";
import { runTaskBreakdown } from "./taskBreakdownRunner.js";
import { createProject, createTask, getTask, listTasks, updateTask } from "../services/taskService.js";
import { gateDoing, installChainHooks, uninstallChainHooks } from "../services/chainService.js";
import { FAKE_CLAUDE, makeRepo } from "../test-utils/fakeRepo.js";

const dirs: string[] = [];
const tick = () => new Promise((r) => setImmediate(() => setImmediate(r)));
let n = 0;

async function project() {
  n += 1;
  const repo = makeRepo("clauflow-plannerdeps-repo-");
  dirs.push(repo);
  return createProject({ name: `pd ${n}`, repoPath: repo, defaultBranch: "main", slug: `pd${n}${Date.now().toString(36)}` });
}

beforeAll(() => installChainHooks());

beforeEach(() => {
  process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
  const state = mkdtempSync(join(tmpdir(), "clauflow-plannerdeps-state-"));
  dirs.push(state);
  process.env.FAKE_CLAUDE_STATE = state;
  process.env.FAKE_CLAUDE_SCENARIO = "pass";
  exec.enqueued.length = 0;
  ws.created.length = 0;
  ws.updated.length = 0;
});

afterAll(() => {
  uninstallChainHooks();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("planner dependencies (zincir F3, §5.5)", () => {
  it("saves the plan's dependsOn as edges, and task_created already carries them", async () => {
    const p = await project();
    process.env.FAKE_CLAUDE_SCENARIO = "plan_deps";
    await runProjectPlanner(p.id, "Build a thing", 5);
    const tasks = (await listTasks()).filter((t) => t.projectId === p.id);
    const byTitle = new Map(tasks.map((t) => [t.title, t]));
    const schema = byTitle.get("Fake schema")!;
    expect(byTitle.get("Fake api")!.dependsOn).toEqual([schema.id]);
    expect(byTitle.get("Fake docs")!.dependsOn).toEqual([schema.id]);
    expect(schema.dependsOn).toEqual([]);
    expect(ws.created.map((c) => [c.title, c.dependsOn])).toEqual([
      ["Fake schema", []],
      ["Fake api", [schema.id]],
      ["Fake docs", [schema.id]],
    ]);
  });

  it("without dependsOn in the reply the tasks stay unchained", async () => {
    const p = await project();
    await runProjectPlanner(p.id, "Build a thing", 5);
    const tasks = (await listTasks()).filter((t) => t.projectId === p.id);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.dependsOn.length === 0)).toBe(true);
    expect(ws.created.every((c) => c.dependsOn.length === 0)).toBe(true);
  });
});

describe("breakdown dependencies (zincir F3, §3/7)", () => {
  it("a waiting dependent of the parent does not start when the parent closes; it starts after every subtask is done", async () => {
    const p = await project();
    const x = await createTask({ projectId: p.id, title: "X (parent's dependency)" });
    const parent = await createTask({ projectId: p.id, title: "Parent", dependsOn: [x.id] });
    const d = await createTask({ projectId: p.id, title: "D", dependsOn: [parent.id] });
    expect(gateDoing(d.id).kind).toBe("wait");

    process.env.FAKE_CLAUDE_SCENARIO = "plan_deps";
    await runTaskBreakdown(parent.id, "Split it", 5);
    await tick();

    expect((await getTask(parent.id))!.status).toBe("done");
    const subs = (await listTasks()).filter((t) => t.parentTaskId === parent.id);
    const byTitle = new Map(subs.map((t) => [t.title, t]));
    const schema = byTitle.get("Fake schema")!;
    const api = byTitle.get("Fake api")!;
    const docs = byTitle.get("Fake docs")!;
    // Internal chain kept; the root subtask inherits the parent's dependency.
    expect(schema.dependsOn).toEqual([x.id]);
    expect(api.dependsOn).toEqual([schema.id]);
    expect(docs.dependsOn).toEqual([schema.id]);
    expect(ws.created.find((c) => c.id === schema.id)!.dependsOn).toEqual([x.id]);

    // The parent's done trigger fired, but D now waits on the subtasks too.
    const dNow = (await getTask(d.id))!;
    expect(dNow.agent.status).toBe("waiting_deps");
    expect([...dNow.dependsOn].sort()).toEqual([parent.id, schema.id, api.id, docs.id].sort());
    expect(exec.enqueued).toEqual([]);
    // D's edge change was broadcast before the parent closed.
    expect(ws.updated.find((u) => u.id === d.id)!.dependsOn).toHaveLength(4);

    for (const t of [x, schema, api]) {
      await updateTask(t.id, { status: "done" });
      await tick();
    }
    expect(exec.enqueued).toEqual([]);
    expect((await getTask(d.id))!.agent.status).toBe("waiting_deps");

    await updateTask(docs.id, { status: "done" });
    await tick();
    expect(exec.enqueued).toEqual([d.id]);
  });

  it("without dependsOn in the reply subtasks only inherit the parent's dependencies; started dependents are not relinked", async () => {
    const p = await project();
    const x = await createTask({ projectId: p.id, title: "X" });
    const parent = await createTask({ projectId: p.id, title: "Parent", dependsOn: [x.id] });
    const todoDep = await createTask({ projectId: p.id, title: "todo dependent", dependsOn: [parent.id] });
    const reviewDep = await createTask({ projectId: p.id, title: "review dependent", dependsOn: [parent.id] });
    await updateTask(reviewDep.id, { status: "review" });

    await runTaskBreakdown(parent.id, "Split it", 5);
    await tick();

    const subs = (await listTasks()).filter((t) => t.parentTaskId === parent.id);
    expect(subs).toHaveLength(2);
    expect(subs.every((t) => t.dependsOn.length === 1 && t.dependsOn[0] === x.id)).toBe(true);
    expect((await getTask(todoDep.id))!.dependsOn).toHaveLength(3);
    expect((await getTask(reviewDep.id))!.dependsOn).toEqual([parent.id]);
    expect(exec.enqueued).toEqual([]);
  });
});
