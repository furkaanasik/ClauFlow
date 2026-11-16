import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-long-text-${process.pid}-${Date.now()}`;
});

import { rmSync } from "node:fs";
import { createProject, createTask, getTask } from "../services/taskService.js";
import { getComments } from "../services/commentService.js";
import { makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import { LONG_TEXT_MAX_CHARS } from "../utils/http.js";
import tasksRouter from "./tasks.js";
import commentsRouter from "./comments.js";
import type { Project } from "../types/index.js";

let server: TestServer;
let project: Project;
let repo: string;

async function call(method: string, path: string, body: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
}

beforeAll(async () => {
  repo = makeRepo("clauflow-long-text-");
  project = await createProject({
    name: "long text",
    repoPath: repo,
    defaultBranch: "main",
    slug: `lt${Date.now().toString(36)}`,
  });
  server = await startTestServer([
    ["/api/tasks/:id/comments", commentsRouter],
    ["/api/tasks", tasksRouter],
  ]);
});

afterAll(async () => {
  await server.close();
  rmSync(repo, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("long text (pasted design docs)", () => {
  it("the JSON body limit accepts a 300 KB task description and stores it intact", async () => {
    const description = "Ünite — design doc line\n".repeat(Math.ceil((300 * 1024) / 26));
    expect(Buffer.byteLength(JSON.stringify({ description }), "utf8")).toBeGreaterThan(300 * 1024);
    const r = await call("POST", "/api/tasks", { projectId: project.id, title: "Design doc", description });
    expect(r.status).toBe(201);
    const stored = await getTask(r.json!.task.id as string);
    expect(stored!.description).toBe(description);
  });

  it("accepts a 50 KB comment", async () => {
    // No branch: the comment is stored, no agent run starts.
    const task = await createTask({ projectId: project.id, title: "c" });
    const body = "x".repeat(50 * 1024);
    const r = await call("POST", `/api/tasks/${task.id}/comments`, { body });
    expect(r.status).toBe(201);
    expect(getComments(task.id)[0]!.body).toBe(body);
  });

  it("still rejects a comment past the safety cap", async () => {
    const task = await createTask({ projectId: project.id, title: "c2" });
    const r = await call("POST", `/api/tasks/${task.id}/comments`, { body: "x".repeat(LONG_TEXT_MAX_CHARS + 1) });
    expect(r.status).toBe(400);
  });
});
