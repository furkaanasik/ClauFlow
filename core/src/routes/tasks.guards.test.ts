import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-tasks-guards-${process.pid}-${Date.now()}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTask, updateTask } from "../services/taskService.js";
import { BUILTIN_TEAM_IDS } from "../services/teamTemplates.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import tasksRouter from "./tasks.js";
import type { Task } from "../types/index.js";

let server: TestServer;
let tmp = "";
let projectId = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function taskIn(status: Task["status"], teamId: string | null = null): Promise<Task> {
  const t = await createTask({ projectId, title: `t-${status}`, teamId });
  return updateTask(t.id, { status });
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "clauflow-guards-"));
  projectId = (await createProject({ name: "Guards", repoPath: join(tmp, "repo"), slug: "guards" })).id;
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

afterAll(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("D4: finished and running tasks", () => {
  it("PATCH teamId on a done task answers 409 task_done; other tasks and other fields still update", async () => {
    const done = await taskIn("done", BUILTIN_TEAM_IDS.solo);
    expect(await call("PATCH", `/api/tasks/${done.id}`, { teamId: BUILTIN_TEAM_IDS.hataAvi })).toEqual({
      status: 409,
      json: { error: "task_done" },
    });
    expect((await call("PATCH", `/api/tasks/${done.id}`, { teamId: null })).status).toBe(409);
    expect((await call("PATCH", `/api/tasks/${done.id}`, { teamId: BUILTIN_TEAM_IDS.solo })).status).toBe(200);
    expect((await call("PATCH", `/api/tasks/${done.id}`, { title: "renamed" })).json.task.title).toBe("renamed");

    const todo = await taskIn("todo");
    const ok = await call("PATCH", `/api/tasks/${todo.id}`, { teamId: BUILTIN_TEAM_IDS.hataAvi });
    expect(ok.status).toBe(200);
    expect(ok.json.task.teamId).toBe(BUILTIN_TEAM_IDS.hataAvi);
  });

  it("POST /breakdown answers 409 task_done / task_running before starting anything", async () => {
    const body = { prompt: "split it" };
    expect(await call("POST", `/api/tasks/${(await taskIn("done")).id}/breakdown`, body)).toEqual({
      status: 409,
      json: { error: "task_done" },
    });
    expect(await call("POST", `/api/tasks/${(await taskIn("doing")).id}/breakdown`, body)).toEqual({
      status: 409,
      json: { error: "task_running" },
    });
    const todo = await taskIn("todo");
    expect((await call("POST", `/api/tasks/${todo.id}/breakdown`, { prompt: "x", uiLang: "de" })).status).toBe(400);
  });
});

describe("D6a: uiLang on PATCH", () => {
  it("accepts tr/en, rejects anything else and never stores it", async () => {
    const t = await taskIn("todo");
    expect((await call("PATCH", `/api/tasks/${t.id}`, { title: "x", uiLang: "de" })).status).toBe(400);
    const ok = await call("PATCH", `/api/tasks/${t.id}`, { title: "y", uiLang: "tr" });
    expect(ok.status).toBe(200);
    expect(ok.json.task.title).toBe("y");
    expect(ok.json.task).not.toHaveProperty("uiLang");
  });
});

describe("D6d: error codes", () => {
  it("missing projectId, unknown task and unknown project answer codes", async () => {
    expect(await call("GET", "/api/tasks")).toEqual({ status: 400, json: { error: "project_id_required" } });
    expect(await call("PATCH", "/api/tasks/task_missing", { title: "x" })).toEqual({
      status: 404,
      json: { error: "not_found" },
    });
    expect(await call("POST", "/api/tasks", { projectId: "proj_missing", title: "x" })).toEqual({
      status: 404,
      json: { error: "project_not_found" },
    });
    expect(await call("DELETE", "/api/tasks/task_missing")).toEqual({ status: 404, json: { error: "not_found" } });
  });
});
