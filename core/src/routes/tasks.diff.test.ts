import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-taskdiff-${process.pid}-${Date.now()}`;
});

import { rmSync } from "node:fs";
import { createProject, createTask, updateTask } from "../services/taskService.js";
import { DIFF_CHAR_CAP } from "../services/taskDiff.js";
import { git, makeRepo, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import tasksRouter from "./tasks.js";

let server: TestServer;
const dirs: string[] = [];

async function get(path: string) {
  const res = await fetch(`${server.url}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** Repo with `feature/x` one commit ahead of main; main also moves on after the fork. */
async function setup(body: string) {
  const repo = makeRepo("clauflow-taskdiff-");
  dirs.push(repo);
  git(repo, "checkout", "-q", "-b", "feature/x");
  writeRepoFile(repo, "src/a.txt", body);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat: a");
  git(repo, "checkout", "-q", "main");
  writeRepoFile(repo, "main-only.txt", "base moved\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: base");
  const project = await createProject({ name: `diff ${dirs.length}`, repoPath: repo, defaultBranch: "main" });
  const task = await createTask({ projectId: project.id, title: "t" });
  return { repo, project, task };
}

beforeAll(async () => {
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("GET /api/tasks/:id/diff (plan §5.2)", () => {
  it("returns stat + diff of base...branch (only the branch's side), without touching HEAD", async () => {
    const { repo, task } = await setup("hello\n");
    await updateTask(task.id, { status: "review", branch: "feature/x" });
    const r = await get(`/api/tasks/${task.id}/diff`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ base: "main", branch: "feature/x", truncated: false });
    expect(r.json.stat).toContain("src/a.txt");
    expect(r.json.stat).toContain("1 file changed");
    expect(r.json.diff).toContain("diff --git a/src/a.txt b/src/a.txt");
    expect(r.json.diff).toContain("+hello");
    expect(r.json.diff).not.toContain("main-only.txt");
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("no branch on the task, or the branch is gone → 404 no_branch", async () => {
    const { repo, task } = await setup("x\n");
    expect(await get(`/api/tasks/${task.id}/diff`)).toEqual({ status: 404, json: { error: "no_branch" } });
    await updateTask(task.id, { branch: "feature/gone" });
    expect(await get(`/api/tasks/${task.id}/diff`)).toEqual({ status: 404, json: { error: "no_branch" } });
    expect(git(repo, "branch", "--list", "feature/gone")).toBe("");
  });

  it("cuts a large diff at the cap on a line boundary and flags it", async () => {
    const line = `${"y".repeat(99)}\n`;
    const { task } = await setup(line.repeat(3000)); // ~300 KB of added lines
    await updateTask(task.id, { branch: "feature/x" });
    const r = await get(`/api/tasks/${task.id}/diff`);
    expect(r.status).toBe(200);
    expect(r.json.truncated).toBe(true);
    expect(r.json.diff.length).toBeLessThanOrEqual(DIFF_CHAR_CAP);
    expect(r.json.diff.length).toBeGreaterThan(DIFF_CHAR_CAP - 200);
    expect(r.json.diff.endsWith("\n")).toBe(true);
  });

  it("unknown task → 404 not_found", async () => {
    expect((await get(`/api/tasks/nope/diff`)).status).toBe(404);
  });
});
