import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-conflict-guards-${process.pid}-${Date.now()}`;
});

import { rmSync } from "node:fs";
import { createProject, createTask, getTask, updateTask } from "../services/taskService.js";
import { getComments } from "../services/commentService.js";
import { git, makeRepo, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import { __setResolvingForTest, isResolving } from "../agents/conflictResolver.js";
import tasksRouter from "./tasks.js";
import commentsRouter from "./comments.js";
import type { Task } from "../types/index.js";

let server: TestServer;
const dirs: string[] = [];
const BRANCH = "feature/clf-5-x";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
}

/** A task in review with a mergeable branch, in the resolver's "resolving" state. */
async function resolvingTask(): Promise<{ repo: string; task: Task }> {
  const repo = makeRepo("clauflow-conflict-guards-");
  dirs.push(repo);
  git(repo, "checkout", "-q", "-b", BRANCH);
  writeRepoFile(repo, "x.txt", "branch\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat: x");
  git(repo, "checkout", "-q", "main");
  const project = await createProject({
    name: `cg ${dirs.length}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `cg${dirs.length}${Date.now().toString(36)}`,
  });
  const created = await createTask({ projectId: project.id, title: "x" });
  const task = await updateTask(created.id, {
    status: "review",
    branch: BRANCH,
    agent: { status: "resolving_conflict", currentStep: "resolving", error: null },
  });
  return { repo, task };
}

const snapshot = (repo: string) => ({
  main: git(repo, "rev-parse", "main"),
  branch: git(repo, "rev-parse", BRANCH),
  head: git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
});

beforeAll(async () => {
  server = await startTestServer([
    ["/api/tasks/:id/comments", commentsRouter],
    ["/api/tasks", tasksRouter],
  ]);
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("guards while the conflict resolver runs (zincir F4.6, §3/42, Z38)", () => {
  it("PATCH done / todo / agent → 409 conflict_resolving; nothing changes, no merge attempt", async () => {
    const { repo, task } = await resolvingTask();
    const fake = __setResolvingForTest(task.id, "running");
    try {
      const before = snapshot(repo);
      for (const body of [{ status: "done" }, { status: "todo" }, { status: "doing" }, { agent: { status: "idle" } }]) {
        expect(await call("PATCH", `/api/tasks/${task.id}`, body)).toEqual({
          status: 409,
          json: { error: "conflict_resolving" },
        });
      }
      const after = await getTask(task.id);
      expect(after).toMatchObject({ status: "review", branch: BRANCH });
      expect(after!.agent).toMatchObject({ status: "resolving_conflict", currentStep: "resolving" });
      expect(snapshot(repo)).toEqual(before);
      expect(git(repo, "log", "--merges", "--oneline", "main")).toBe("");
    } finally {
      fake.release();
    }
  });

  it("title / description PATCH still answers 200", async () => {
    const { task } = await resolvingTask();
    const fake = __setResolvingForTest(task.id);
    try {
      const r = await call("PATCH", `/api/tasks/${task.id}`, { title: "renamed", description: "d", status: "review" });
      expect(r.status).toBe(200);
      expect(r.json!.task).toMatchObject({ title: "renamed", description: "d", status: "review" });
      expect(r.json!.task.agent.status).toBe("resolving_conflict");
    } finally {
      fake.release();
    }
  });

  it("POST /comments → 409 conflict_resolving, no comment row", async () => {
    const { task } = await resolvingTask();
    const fake = __setResolvingForTest(task.id);
    try {
      expect(await call("POST", `/api/tasks/${task.id}/comments`, { body: "please also fix y" })).toEqual({
        status: 409,
        json: { error: "conflict_resolving" },
      });
      expect(getComments(task.id)).toEqual([]);
    } finally {
      fake.release();
    }
  });

  it("DELETE → 409 conflict_resolving, the task stays", async () => {
    const { task } = await resolvingTask();
    const fake = __setResolvingForTest(task.id);
    try {
      expect(await call("DELETE", `/api/tasks/${task.id}`)).toEqual({
        status: 409,
        json: { error: "conflict_resolving" },
      });
      expect(await getTask(task.id)).not.toBeNull();
    } finally {
      fake.release();
    }
  });

  it("abort → 200 source resolver and signals the run (queued and running)", async () => {
    for (const phase of ["queued", "running"] as const) {
      const { repo, task } = await resolvingTask();
      const before = snapshot(repo);
      const fake = __setResolvingForTest(task.id, phase);
      try {
        expect(await call("POST", `/api/tasks/${task.id}/abort`)).toEqual({
          status: 200,
          json: { aborted: true, source: "resolver" },
        });
        expect(fake.signal.aborted).toBe(true);
        expect(snapshot(repo)).toEqual(before);
      } finally {
        fake.release();
      }
    }
  });

  it("persisted resolving state without a run: guards hold, abort closes it as conflict_unresolved:aborted", async () => {
    const { task } = await resolvingTask();
    expect(isResolving(task.id)).toBe(false);
    expect((await call("PATCH", `/api/tasks/${task.id}`, { status: "done" })).json).toEqual({
      error: "conflict_resolving",
    });
    expect((await call("DELETE", `/api/tasks/${task.id}`)).status).toBe(409);
    expect(await call("POST", `/api/tasks/${task.id}/abort`)).toEqual({
      status: 200,
      json: { aborted: true, source: "resolver" },
    });
    const after = await getTask(task.id);
    expect(after!.status).toBe("review");
    expect(after!.agent).toMatchObject({ status: "error", error: "conflict_unresolved:aborted" });
    // No longer resolving: a second abort finds nothing to stop.
    expect(await call("POST", `/api/tasks/${task.id}/abort`)).toEqual({
      status: 409,
      json: { error: "task_not_running" },
    });
  });

  it("a review task that is not resolving is not guarded (merge_conflict / error rows untouched by the guards)", async () => {
    const { task } = await resolvingTask();
    await updateTask(task.id, { agent: { status: "error", currentStep: undefined, error: "merge_conflict" } });
    const r = await call("PATCH", `/api/tasks/${task.id}`, { title: "still editable", agent: { error: "merge_conflict" } });
    expect(r.status).toBe(200);
    expect(await call("POST", `/api/tasks/${task.id}/abort`)).toEqual({
      status: 409,
      json: { error: "task_not_running" },
    });
  });
});
