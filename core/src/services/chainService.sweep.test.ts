import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-chainsweep-${process.pid}-${Date.now()}`;
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
import { createProject, createTask, db, getTask } from "./taskService.js";
import { gateDoing, sweepWaitingTasks } from "./chainService.js";

beforeEach(() => {
  exec.enqueued.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("sweepWaitingTasks (zincir F2, plan §3/25, E5)", () => {
  it("reports a waiting task whose dependency became done behind the trigger's back; starts nothing", async () => {
    const p = await createProject({
      name: "sweep",
      repoPath: "/tmp/clauflow-chainsweep-repo",
      slug: `sw${Date.now().toString(36)}`,
    });
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    const d = await createTask({ projectId: p.id, title: "D" });
    const c = await createTask({ projectId: p.id, title: "C", dependsOn: [d.id] });
    gateDoing(b.id, "en");
    gateDoing(c.id, "en");
    // Crash window: A is done in the DB but the done trigger never ran.
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(a.id);
    const beforeB = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(b.id);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = sweepWaitingTasks();
    expect(result.waiting).toEqual([b.id, c.id]);
    expect(result.ready).toEqual([b.id]);
    expect(exec.enqueued).toEqual([]);
    expect((await getTask(b.id))!.agent.status).toBe("waiting_deps");
    expect(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(b.id)).toEqual(beforeB);

    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not auto-started");
    expect(lines[0]).toContain(b.displayId!);
    expect(lines[0]).not.toContain(c.displayId!);
    warn.mockRestore();
  });

  it("no ready task → no warning", async () => {
    db.prepare(`UPDATE tasks SET status = 'todo', agentStatus = 'idle' WHERE agentStatus = 'waiting_deps'`).run();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sweepWaitingTasks()).toEqual({ waiting: [], ready: [] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
