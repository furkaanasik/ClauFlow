import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-chainadv-${process.pid}-${Date.now()}`;
});

const exec = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("../agents/executor.js", () => ({
  enqueue: (task: { id: string }) => exec.enqueued.push(task.id),
  abort: () => false,
  isRunning: () => false,
  runPhase: () => null,
  waitForIdle: async () => {},
}));

const ws = vi.hoisted(() => ({ advanced: [] as Array<{ taskId: string; payload: any }> }));
vi.mock("./wsService.js", async (orig) => {
  const real = await orig<typeof import("./wsService.js")>();
  return {
    ...real,
    broadcastChainAdvanced: (taskId: string, payload: unknown) => ws.advanced.push({ taskId, payload }),
  };
});

import { rmSync } from "node:fs";
import { createProject, createTask, getTask, updateTask } from "./taskService.js";
import { gateDoing, installChainHooks, tryStartWaiting, uninstallChainHooks } from "./chainService.js";

let n = 0;
async function project() {
  n += 1;
  return createProject({
    name: `adv ${n}`,
    repoPath: `/tmp/clauflow-chainadv-repo-${n}`,
    slug: `ad${n}${Date.now().toString(36)}`,
  });
}

/** Let the setImmediate listeners run. */
const tick = () => new Promise((r) => setImmediate(() => setImmediate(r)));

beforeAll(() => {
  installChainHooks();
  installChainHooks(); // second call is a no-op: no double start
});

beforeEach(() => {
  exec.enqueued.length = 0;
  ws.advanced.length = 0;
});

afterAll(() => {
  uninstallChainHooks();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("done trigger (zincir F2, plan §3/3, §5.3)", () => {
  it("one dependent starts when its dependency becomes done (review → done: merged)", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    gateDoing(b.id);
    await updateTask(a.id, { status: "review" });
    await tick();
    expect(exec.enqueued).toEqual([]);

    await updateTask(a.id, { status: "done" });
    expect(exec.enqueued).toEqual([]); // the caller's broadcast goes first
    await tick();
    expect(exec.enqueued).toEqual([b.id]);
    expect((await getTask(b.id))!.agent.status).toBe("idle");
    expect(ws.advanced).toEqual([
      {
        taskId: a.id,
        payload: {
          projectId: p.id,
          displayId: a.displayId,
          merged: true,
          started: [{ id: b.id, displayId: b.displayId }],
        },
      },
    ]);
  });

  it("fan-out: B→A and C→A both start, in one chain_advanced event", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    const c = await createTask({ projectId: p.id, title: "C", dependsOn: [a.id] });
    gateDoing(b.id);
    gateDoing(c.id);
    await updateTask(a.id, { status: "done" });
    await tick();
    expect(exec.enqueued.sort()).toEqual([b.id, c.id].sort());
    expect(ws.advanced).toHaveLength(1);
    expect(ws.advanced[0]!.payload.started).toEqual([
      { id: b.id, displayId: b.displayId },
      { id: c.id, displayId: c.displayId },
    ]);
  });

  it("fan-in: C→A, C→B; A done → C waits; B done → C starts", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B" });
    const c = await createTask({ projectId: p.id, title: "C", dependsOn: [a.id, b.id] });
    gateDoing(c.id);
    await updateTask(a.id, { status: "done" });
    await tick();
    expect(exec.enqueued).toEqual([]);
    expect(ws.advanced).toEqual([]);
    expect((await getTask(c.id))!.agent.status).toBe("waiting_deps");
    await updateTask(b.id, { status: "done" });
    await tick();
    expect(exec.enqueued).toEqual([c.id]);
    expect(ws.advanced.map((e) => e.taskId)).toEqual([b.id]);
  });

  it("idempotent: done twice, then a manual tryStartWaiting → enqueue once", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    gateDoing(b.id);
    await updateTask(a.id, { status: "done" });
    await updateTask(a.id, { status: "done", title: "A again" }); // done → done is no transition
    await tick();
    expect(tryStartWaiting(b.id)).toBeNull();
    await tick();
    expect(exec.enqueued).toEqual([b.id]);
    expect(ws.advanced).toHaveLength(1);
  });

  it("a dependent still in todo does not start", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    await updateTask(a.id, { status: "done" });
    await tick();
    expect(exec.enqueued).toEqual([]);
    expect(ws.advanced).toEqual([]);
    expect((await getTask(b.id))!.status).toBe("todo");
  });

  it("merged is false for todo → done (approval dialog)", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    gateDoing(b.id);
    await updateTask(a.id, { status: "done" });
    await tick();
    expect(ws.advanced[0]!.payload.merged).toBe(false);
    expect(exec.enqueued).toEqual([b.id]);
  });
});
