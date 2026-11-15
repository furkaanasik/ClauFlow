import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Own throwaway DB: never touch the shared core/data/tasks.db (dev server, master).
vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-taskService-orphan-${process.pid}-${Date.now()}`;
});
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import {
  createProject,
  createTask,
  db,
  getNodeRun,
  getProject,
  getTask,
  insertNodeRun,
  recoverOrphanedTasks,
  updateTask,
} from "./taskService.js";
import { recoverAndBroadcastOrphans } from "./orphanRecovery.js";
import { createTeamRun, getTeamRun } from "./teamRunService.js";
import { resolveTeamForTask } from "./teamService.js";
import { attachWebSocket, closeWebSocket } from "./wsService.js";

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

  it("keeps a task waiting for its dependencies (zincir, plan §3/25): row unchanged, no error", async () => {
    const waiting = await createTask({ projectId, title: "waiting on deps" });
    try {
      db.prepare(
        `UPDATE tasks SET status = 'doing', agentStatus = 'waiting_deps', agentCurrentStep = 'waiting_deps',
           waitUiLang = 'en' WHERE id = ?`,
      ).run(waiting.id);
      const before = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(waiting.id);
      const result = await recoverAndBroadcastOrphans();
      expect(result.taskIds).not.toContain(waiting.id);
      expect(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(waiting.id)).toEqual(before);
      const after = (await getTask(waiting.id))!;
      expect(after.status).toBe("doing");
      expect(after.agent.status).toBe("waiting_deps");
      expect(after.agent.error).toBeNull();
    } finally {
      db.prepare(`DELETE FROM tasks WHERE id = ?`).run(waiting.id);
    }
  });

  it("writes the server_restart code, errors stuck node runs and broadcasts every changed row (A8a)", async () => {
    await updateTask(taskId, { status: "doing", agent: { status: "running", error: null } });
    const run = createTeamRun(taskId, resolveTeamForTask((await getTask(taskId))!, (await getProject(projectId))!));
    const nodeRun = insertNodeRun({ id: `nr-${SUFFIX}`, taskId, nodeId: "role:developer:1", nodeType: "developer" });
    expect(nodeRun.status).toBe("running");

    const server = http.createServer();
    attachWebSocket(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: Array<{ type: string; taskId?: string; payload?: { id?: string; status?: string } }> = [];
    ws.on("message", (data) => messages.push(JSON.parse(String(data))));
    await new Promise<void>((r) => ws.once("open", () => r()));
    try {
      const result = await recoverAndBroadcastOrphans();
      expect(result).toEqual({ taskIds: [taskId], runIds: [run.id], nodeRunIds: [nodeRun.id] });
      for (let i = 0; i < 50 && messages.length < 4; i++) await new Promise((r) => setTimeout(r, 20));

      const task = (await getTask(taskId))!;
      expect(task.status).toBe("todo");
      expect(task.agent.error).toBe("server_restart");
      expect(getNodeRun(nodeRun.id)).toMatchObject({ status: "error", errorMessage: "server_restart" });
      expect(getTeamRun(run.id)).toMatchObject({ status: "error", stopReason: "server_restart" });

      const types = messages.map((m) => m.type);
      expect(types).toEqual(expect.arrayContaining(["task_updated", "team_run_updated", "node_finished"]));
      expect(messages.find((m) => m.type === "team_run_updated")!.payload).toMatchObject({ id: run.id, status: "error" });
      expect(messages.find((m) => m.type === "node_finished")!.payload).toMatchObject({ id: nodeRun.id, status: "error" });
    } finally {
      ws.close();
      await closeWebSocket();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

afterAll(async () => {
  const { rmSync } = await import("node:fs");
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});
