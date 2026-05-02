import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  createProject,
  createTask,
  db,
  getNodeRun,
  insertNodeRun,
  listNodeRunsByTask,
  updateNodeRun,
} from "./taskService.js";

const SUFFIX = `nrtest_${Date.now()}`;
let projectId = "";
let taskId = "";

beforeAll(async () => {
  const project = await createProject({
    name: `NodeRuns Test ${SUFFIX}`,
    repoPath: `/tmp/${SUFFIX}`,
    defaultBranch: "main",
    slug: SUFFIX.toLowerCase().replace(/_/g, "-"),
  });
  projectId = project.id;
  const task = await createTask({
    projectId,
    title: "node-run round-trip test",
    description: "synthetic test fixture",
  });
  taskId = task.id;
});

afterEach(() => {
  db.prepare(`DELETE FROM task_node_runs WHERE taskId = ?`).run(taskId);
});

afterAll(() => {
  // Self-cleaning: tasks → projects FK has no ON DELETE CASCADE, so the task
  // must be removed before the project. Children of `tasks` (`task_node_runs`,
  // `task_tool_calls`, `task_agent_texts`, `comments`) DO cascade.
  if (taskId) {
    db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  }
  if (projectId) {
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
  }
});

describe("task_node_runs CRUD", () => {
  it("inserts a row and reads it back via getNodeRun", () => {
    const id = `noderun_${SUFFIX}_1`;
    const inserted = insertNodeRun({
      id,
      taskId,
      nodeId: "legacy:coder",
      nodeType: "coder",
      model: "claude-sonnet-4-5",
    });
    expect(inserted.id).toBe(id);
    expect(inserted.status).toBe("running");
    expect(inserted.nodeType).toBe("coder");
    expect(inserted.inputTokens).toBe(0);

    const fetched = getNodeRun(id);
    expect(fetched).not.toBeNull();
    expect(fetched?.taskId).toBe(taskId);
    expect(fetched?.model).toBe("claude-sonnet-4-5");
  });

  it("updates only patched fields", () => {
    const id = `noderun_${SUFFIX}_2`;
    insertNodeRun({
      id,
      taskId,
      nodeId: "legacy:coder",
      nodeType: "coder",
    });

    const updated = updateNodeRun(id, {
      status: "done",
      outputTokens: 1234,
      finishedAt: "2026-05-02T01:23:45.000Z",
    });
    expect(updated?.status).toBe("done");
    expect(updated?.outputTokens).toBe(1234);
    expect(updated?.finishedAt).toBe("2026-05-02T01:23:45.000Z");
    expect(updated?.inputTokens).toBe(0);
    expect(updated?.nodeId).toBe("legacy:coder");
  });

  it("INSERT OR REPLACE — same id overwrites", () => {
    const id = `noderun_${SUFFIX}_3`;
    insertNodeRun({
      id,
      taskId,
      nodeId: "legacy:coder",
      nodeType: "coder",
      inputTokens: 100,
    });
    insertNodeRun({
      id,
      taskId,
      nodeId: "legacy:coder",
      nodeType: "reviewer",
      inputTokens: 999,
    });
    const fetched = getNodeRun(id);
    expect(fetched?.nodeType).toBe("reviewer");
    expect(fetched?.inputTokens).toBe(999);
  });

  it("listNodeRunsByTask returns rows in startedAt ascending order", () => {
    const t0 = "2026-05-02T01:00:00.000Z";
    const t1 = "2026-05-02T01:05:00.000Z";
    const t2 = "2026-05-02T01:10:00.000Z";
    insertNodeRun({
      id: `noderun_${SUFFIX}_4_b`,
      taskId,
      nodeId: "n2",
      nodeType: "coder",
      startedAt: t1,
    });
    insertNodeRun({
      id: `noderun_${SUFFIX}_4_c`,
      taskId,
      nodeId: "n3",
      nodeType: "reviewer",
      startedAt: t2,
    });
    insertNodeRun({
      id: `noderun_${SUFFIX}_4_a`,
      taskId,
      nodeId: "n1",
      nodeType: "planner",
      startedAt: t0,
    });

    const rows = listNodeRunsByTask(taskId);
    expect(rows.map((r) => r.nodeId)).toEqual(["n1", "n2", "n3"]);
  });

  it("artifact JSON round-trip preserves shape", () => {
    const id = `noderun_${SUFFIX}_5`;
    insertNodeRun({
      id,
      taskId,
      nodeId: "legacy:coder",
      nodeType: "coder",
      inputArtifact: { analysis: "do the thing", priority: 1 },
    });
    const fetched = getNodeRun(id);
    expect(fetched?.inputArtifact).toEqual({
      analysis: "do the thing",
      priority: 1,
    });
  });

  it("malformed artifact JSON in row falls back to null", () => {
    const id = `noderun_${SUFFIX}_6`;
    insertNodeRun({
      id,
      taskId,
      nodeId: "legacy:coder",
      nodeType: "coder",
    });
    db.prepare(
      `UPDATE task_node_runs SET inputArtifact = '{not valid json' WHERE id = ?`,
    ).run(id);
    const fetched = getNodeRun(id);
    expect(fetched?.inputArtifact).toBeNull();
  });
});
