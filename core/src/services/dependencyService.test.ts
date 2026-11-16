import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-depsvc-${process.pid}-${Date.now()}`;
});

import { rmSync } from "node:fs";
import { createProject, createTask, db, deleteTask, getTask, updateTask } from "./taskService.js";
import {
  DependencyError,
  findCycle,
  listDependencies,
  listDependents,
  listProjectEdges,
  setDependencies,
  unmetDependencies,
} from "./dependencyService.js";

let n = 0;
async function project() {
  n += 1;
  return createProject({
    name: `depsvc ${n}`,
    repoPath: `/tmp/clauflow-depsvc-repo-${n}`,
    slug: `ds${n}${Date.now().toString(36)}`,
  });
}

async function tasks(count: number) {
  const p = await project();
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(await createTask({ projectId: p.id, title: `T${i}` }));
  return { p, t: out };
}

function err(fn: () => unknown): DependencyError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DependencyError) return e;
    throw e;
  }
  throw new Error("expected a DependencyError");
}

afterAll(() => {
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("dependencyService (zincir F1, plan §5.2)", () => {
  it("setDependencies writes the set and returns the fresh task; list helpers agree", async () => {
    const { p, t } = await tasks(3);
    const [a, b, c] = t as [typeof t[0], typeof t[0], typeof t[0]];
    const next = setDependencies(c.id, [b.id, a.id]);
    expect(next.dependsOn).toEqual([a.id, b.id]);
    expect(listDependencies(c.id)).toEqual([a.id, b.id]);
    expect(listDependents(a.id)).toEqual([c.id]);
    expect(listProjectEdges(p.id).sort()).toEqual([[c.id, a.id], [c.id, b.id]].sort());
  });

  it("direct cycle: A→B then B→A is dependency_cycle with the path", async () => {
    const { t } = await tasks(2);
    const [a, b] = t as [typeof t[0], typeof t[0]];
    setDependencies(a.id, [b.id]);
    const e = err(() => setDependencies(b.id, [a.id]));
    expect(e.code).toBe("dependency_cycle");
    expect(e.httpStatus).toBe(409);
    expect(e.extra.path).toEqual([b.displayId, a.displayId, b.displayId]);
    expect(findCycle(b.id, [a.id])).toEqual([b.id, a.id, b.id]);
    expect(listDependencies(b.id)).toEqual([]);
  });

  it("transitive cycle: A→B→C then C→A", async () => {
    const { t } = await tasks(3);
    const [a, b, c] = t as [typeof t[0], typeof t[0], typeof t[0]];
    setDependencies(a.id, [b.id]);
    setDependencies(b.id, [c.id]);
    const e = err(() => setDependencies(c.id, [a.id]));
    expect(e.code).toBe("dependency_cycle");
    expect(e.extra.path).toEqual([c.displayId, a.displayId, b.displayId, c.displayId]);
    // A diamond is fine: D→B, D→C with B→C.
    const d = await createTask({ projectId: a.projectId, title: "D" });
    expect(setDependencies(d.id, [b.id, c.id]).dependsOn).toEqual([b.id, c.id]);
  });

  it("replacing the set ignores the task's own old edges when looking for a cycle", async () => {
    const { t } = await tasks(2);
    const [a, b] = t as [typeof t[0], typeof t[0]];
    setDependencies(b.id, [a.id]);
    // Flip the direction in two steps: drop B→A, then A→B is legal.
    setDependencies(b.id, []);
    expect(setDependencies(a.id, [b.id]).dependsOn).toEqual([b.id]);
  });

  it("self, unknown and cross-project ids are rejected", async () => {
    const { t } = await tasks(2);
    const [a, b] = t as [typeof t[0], typeof t[0]];
    const other = (await tasks(1)).t[0]!;
    expect(err(() => setDependencies(a.id, [a.id])).code).toBe("dependency_self");
    const nf = err(() => setDependencies(a.id, [b.id, "task_nope"]));
    expect(nf.code).toBe("dependency_not_found");
    expect(nf.httpStatus).toBe(404);
    const cp = err(() => setDependencies(a.id, [other.id]));
    expect(cp.code).toBe("dependency_cross_project");
    expect(cp.httpStatus).toBe(400);
    expect(listDependencies(a.id)).toEqual([]);
  });

  it("duplicate ids collapse to one edge", async () => {
    const { t } = await tasks(2);
    const [a, b] = t as [typeof t[0], typeof t[0]];
    expect(setDependencies(b.id, [a.id, a.id, a.id]).dependsOn).toEqual([a.id]);
  });

  it("replacing the set drops the old edges", async () => {
    const { t } = await tasks(3);
    const [a, b, c] = t as [typeof t[0], typeof t[0], typeof t[0]];
    setDependencies(c.id, [a.id]);
    expect(setDependencies(c.id, [b.id]).dependsOn).toEqual([b.id]);
    expect(listDependents(a.id)).toEqual([]);
  });

  it("dependencies_locked unless the task is todo or waiting", async () => {
    const { t } = await tasks(4);
    const [a, rev, run, wait] = t as [typeof t[0], typeof t[0], typeof t[0], typeof t[0]];
    await updateTask(rev.id, { status: "review" });
    await updateTask(run.id, { status: "doing", agent: { status: "running" } });
    db.prepare(`UPDATE tasks SET status = 'doing', agentStatus = 'waiting_deps' WHERE id = ?`).run(wait.id);

    const locked = err(() => setDependencies(rev.id, [a.id]));
    expect(locked.code).toBe("dependencies_locked");
    expect(locked.httpStatus).toBe(409);
    expect(err(() => setDependencies(run.id, [a.id])).code).toBe("dependencies_locked");
    expect(setDependencies(wait.id, [a.id]).dependsOn).toEqual([a.id]);
  });

  it("more than 20 dependencies is too_many_dependencies", async () => {
    const { t } = await tasks(22);
    const target = t[0]!;
    const deps = t.slice(1).map((x) => x.id);
    expect(deps).toHaveLength(21);
    const e = err(() => setDependencies(target.id, deps));
    expect(e.code).toBe("too_many_dependencies");
    expect(e.httpStatus).toBe(400);
    expect(setDependencies(target.id, deps.slice(0, 20)).dependsOn).toHaveLength(20);
  });

  it("unmetDependencies returns only dependencies that are not done", async () => {
    const { t } = await tasks(4);
    const [a, b, c, d] = t as [typeof t[0], typeof t[0], typeof t[0], typeof t[0]];
    setDependencies(d.id, [a.id, b.id, c.id]);
    await updateTask(a.id, { status: "done" });
    await updateTask(b.id, { status: "review" });
    expect(unmetDependencies(d.id).map((x) => x.id)).toEqual([b.id, c.id]);
    await updateTask(b.id, { status: "done" });
    await updateTask(c.id, { status: "done" });
    expect(unmetDependencies(d.id)).toEqual([]);
  });

  it("a deleted dependency's edge is gone", async () => {
    const { t } = await tasks(2);
    const [a, b] = t as [typeof t[0], typeof t[0]];
    setDependencies(b.id, [a.id]);
    await deleteTask(a.id);
    expect(listDependencies(b.id)).toEqual([]);
    expect((await getTask(b.id))!.dependsOn).toEqual([]);
  });
});
