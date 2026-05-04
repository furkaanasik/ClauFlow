import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createProject,
  createTask,
  db,
  getTask,
  recoverOrphanedTasks,
  updateTask,
} from "./taskService.js";

const SUFFIX = `orphantest_${Date.now()}`;
let projectId = "";
let taskId = "";

beforeAll(async () => {
  const project = await createProject({
    name: `Orphan Test ${SUFFIX}`,
    repoPath: `/tmp/${SUFFIX}`,
    defaultBranch: "main",
    slug: SUFFIX.toLowerCase().replace(/_/g, "-"),
  });
  projectId = project.id;
  const task = await createTask({
    projectId,
    title: "orphan recovery test",
    description: "",
  });
  taskId = task.id;
});

afterAll(() => {
  if (taskId) db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  if (projectId) db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
});

describe("recoverOrphanedTasks", () => {
  it("rolls back a doing task to todo+error status", async () => {
    await updateTask(taskId, { status: "doing", agent: { status: "running" } });

    const before = await getTask(taskId);
    expect(before?.status).toBe("doing");

    const recovered = await recoverOrphanedTasks();
    expect(recovered).toBeGreaterThanOrEqual(1);

    const after = await getTask(taskId);
    expect(after?.status).toBe("todo");
    expect(after?.agent.status).toBe("error");
  });

  it("is idempotent — second call returns 0 when no doing tasks remain", async () => {
    const recovered = await recoverOrphanedTasks();
    expect(recovered).toBe(0);
  });
});
