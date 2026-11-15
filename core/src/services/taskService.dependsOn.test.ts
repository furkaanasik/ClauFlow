import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-dependson-${process.pid}-${Date.now()}`;
});

import { rmSync } from "node:fs";
import { createProject, createTask, deleteTask, getTask, listTasks, updateTask } from "./taskService.js";
import { DependencyError } from "./dependencyError.js";

let n = 0;
async function project() {
  n += 1;
  return createProject({
    name: `deps ${n}`,
    repoPath: `/tmp/clauflow-dependson-repo-${n}`,
    slug: `dp${n}${Date.now().toString(36)}`,
  });
}

afterAll(() => {
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("Task.dependsOn (zincir F1, plan §5.2)", () => {
  it("a task without edges has dependsOn = []", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    expect(a.dependsOn).toEqual([]);
    expect((await getTask(a.id))!.dependsOn).toEqual([]);
  });

  it("createTask writes the edges; getTask and listTasks return them in board order", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B" });
    const c = await createTask({ projectId: p.id, title: "C", dependsOn: [b.id, a.id, b.id] });
    expect(c.dependsOn).toEqual([a.id, b.id]);
    expect((await getTask(c.id))!.dependsOn).toEqual([a.id, b.id]);

    const listed = await listTasks(p.id);
    expect(listed.find((t) => t.id === c.id)!.dependsOn).toEqual([a.id, b.id]);
    expect(listed.find((t) => t.id === a.id)!.dependsOn).toEqual([]);
    const all = await listTasks();
    expect(all.find((t) => t.id === c.id)!.dependsOn).toEqual([a.id, b.id]);
  });

  it("updateTask keeps dependsOn on the returned task", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    const next = await updateTask(b.id, { title: "B2", agent: { status: "error", error: "x" } });
    expect(next.dependsOn).toEqual([a.id]);
    expect((await getTask(b.id))!.dependsOn).toEqual([a.id]);
  });

  it("rejects unknown and cross-project ids without creating the task", async () => {
    const p = await project();
    const q = await project();
    const other = await createTask({ projectId: q.id, title: "other" });
    const before = (await listTasks(p.id)).length;

    await expect(createTask({ projectId: p.id, title: "X", dependsOn: ["task_nope"] })).rejects.toMatchObject({
      code: "dependency_not_found",
    });
    await expect(createTask({ projectId: p.id, title: "Y", dependsOn: [other.id] })).rejects.toBeInstanceOf(
      DependencyError,
    );
    await expect(createTask({ projectId: p.id, title: "Y", dependsOn: [other.id] })).rejects.toMatchObject({
      code: "dependency_cross_project",
    });
    expect((await listTasks(p.id)).length).toBe(before);
  });

  it("deleting the dependency removes the edge from the dependent's payload", async () => {
    const p = await project();
    const a = await createTask({ projectId: p.id, title: "A" });
    const b = await createTask({ projectId: p.id, title: "B", dependsOn: [a.id] });
    await deleteTask(a.id);
    expect((await getTask(b.id))!.dependsOn).toEqual([]);
  });
});
