import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-chainsvc-${process.pid}-${Date.now()}`;
});

const exec = vi.hoisted(() => ({
  enqueued: [] as Array<{ id: string; uiLang: string | undefined }>,
  running: new Set<string>(),
}));
vi.mock("../agents/executor.js", () => ({
  enqueue: (task: { id: string }, _p: unknown, opts: { uiLang?: string } = {}) =>
    exec.enqueued.push({ id: task.id, uiLang: opts.uiLang }),
  abort: () => false,
  isRunning: (id: string) => exec.running.has(id),
  runPhase: () => null,
  waitForIdle: async () => {},
}));

import { rmSync } from "node:fs";
import { createProject, createTask, db, getTask, updateTask } from "./taskService.js";
import { abortWaiting, gateDoing, tryStartWaiting } from "./chainService.js";

let n = 0;
async function chain() {
  n += 1;
  const p = await createProject({
    name: `chain ${n}`,
    repoPath: `/tmp/clauflow-chainsvc-repo-${n}`,
    slug: `cs${n}${Date.now().toString(36)}`,
  });
  const a = await createTask({ projectId: p.id, title: "A" });
  const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
  return { p, a, b };
}

function waitUiLang(id: string): string | null {
  return (db.prepare(`SELECT waitUiLang FROM tasks WHERE id = ?`).get(id) as { waitUiLang: string | null }).waitUiLang;
}

beforeEach(() => {
  exec.enqueued.length = 0;
  exec.running.clear();
});

afterAll(() => {
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("gateDoing (zincir F2, plan §3/5)", () => {
  it("with an unmet dependency: wait, row doing/waiting_deps, waitUiLang stored, nothing enqueued", async () => {
    const { a, b } = await chain();
    const gate = gateDoing(b.id, "en");
    expect(gate.kind).toBe("wait");
    expect(gate.unmet).toEqual([a.id]);
    expect(gate.task.status).toBe("doing");
    expect(gate.task.agent).toMatchObject({ status: "waiting_deps", currentStep: "waiting_deps", error: null, log: [] });
    expect(waitUiLang(b.id)).toBe("en");
    expect(exec.enqueued).toEqual([]);
  });

  it("with every dependency done: start, agent reset to idle, waitUiLang cleared", async () => {
    const { a, b } = await chain();
    gateDoing(b.id, "tr");
    await updateTask(a.id, { status: "done" });
    const gate = gateDoing(b.id, "en");
    expect(gate.kind).toBe("start");
    expect(gate.unmet).toEqual([]);
    expect(gate.task.agent).toMatchObject({ status: "idle", error: null, log: [] });
    expect(waitUiLang(b.id)).toBeNull();
    // The gate only writes the row; the caller enqueues.
    expect(exec.enqueued).toEqual([]);
  });

  it("a task without dependencies starts and clears a previous error", async () => {
    const { a } = await chain();
    await updateTask(a.id, { agent: { status: "error", error: "x", log: ["old"] } });
    const gate = gateDoing(a.id);
    expect(gate.kind).toBe("start");
    expect(gate.task.agent).toMatchObject({ status: "idle", error: null, log: [] });
  });
});

describe("tryStartWaiting (zincir F2, plan §3/4)", () => {
  it("returns null while a dependency is unmet; the task keeps waiting", async () => {
    const { b } = await chain();
    gateDoing(b.id, "en");
    expect(tryStartWaiting(b.id)).toBeNull();
    expect((await getTask(b.id))!.agent.status).toBe("waiting_deps");
    expect(exec.enqueued).toEqual([]);
  });

  it("two calls in a row enqueue exactly once, with the stored UI language", async () => {
    const { a, b } = await chain();
    gateDoing(b.id, "en");
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(a.id);
    const first = tryStartWaiting(b.id);
    const second = tryStartWaiting(b.id);
    expect(first?.agent.status).toBe("idle");
    expect(second).toBeNull();
    expect(exec.enqueued).toEqual([{ id: b.id, uiLang: "en" }]);
    expect(waitUiLang(b.id)).toBeNull();
  });

  it("claims the row but does not enqueue while the executor already runs the task", async () => {
    const { a, b } = await chain();
    gateDoing(b.id);
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(a.id);
    exec.running.add(b.id);
    expect(tryStartWaiting(b.id)?.agent.status).toBe("idle");
    expect(exec.enqueued).toEqual([]);
  });

  it("returns null for a task that is not waiting", async () => {
    const { a } = await chain();
    expect(tryStartWaiting(a.id)).toBeNull();
    expect(tryStartWaiting("task_nope")).toBeNull();
    expect(exec.enqueued).toEqual([]);
  });
});

describe("abortWaiting (zincir F2, plan §3/10)", () => {
  it("rolls a waiting task back to todo + aborted_while_waiting; a second call is null", async () => {
    const { b } = await chain();
    gateDoing(b.id, "en");
    const rolled = abortWaiting(b.id);
    expect(rolled?.status).toBe("todo");
    expect(rolled?.agent).toMatchObject({ status: "error", error: "aborted_while_waiting" });
    expect(waitUiLang(b.id)).toBeNull();
    expect(abortWaiting(b.id)).toBeNull();
  });
});
