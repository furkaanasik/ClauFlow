import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-projects-codes-${process.pid}-${Date.now()}`;
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTask, getProject, projectHasActiveTasks, updateTask } from "../services/taskService.js";
import { git, makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import projectsRouter from "./projects.js";
import githubRouter from "./github.js";

let server: TestServer;
let tmp = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function gitDir(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "clauflow-codes-"));
  server = await startTestServer([
    ["/api/projects", projectsRouter],
    ["/api/github", githubRouter],
  ]);
});

afterAll(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("D6d: project routes answer error codes", () => {
  it("POST /projects", async () => {
    const base = { name: "Codes", repoPath: join(tmp, "new-repo") };
    expect(await call("POST", "/api/projects", { ...base, repoPath: "rel/path" })).toEqual({
      status: 400,
      json: { error: "repo_path_not_absolute" },
    });
    expect(await call("POST", "/api/projects", { ...base, repoPath: "/shallow" })).toEqual({
      status: 400,
      json: { error: "repo_path_too_shallow" },
    });
    expect(await call("POST", "/api/projects", { ...base, repoName: "bad name!" })).toEqual({
      status: 400,
      json: { error: "invalid_repo_name" },
    });
    const slug = await call("POST", "/api/projects", { ...base, slug: "Bad--Slug" });
    expect(slug.status).toBe(400);
    expect(slug.json.error).toBe("invalid_slug");
    const body = await call("POST", "/api/projects", { ...base, name: "" });
    expect(body.status).toBe(400);
    expect(body.json.error).toBe("invalid_body");
  });

  it("POST /projects/clone", async () => {
    const base = { repoUrl: "https://example.invalid/x.git", name: "Clone" };
    expect(await call("POST", "/api/projects/clone", { ...base, targetPath: "rel/dir" })).toEqual({
      status: 400,
      json: { error: "target_path_not_absolute" },
    });
    const full = join(tmp, "full");
    mkdirSync(full);
    writeFileSync(join(full, "a.txt"), "x");
    expect(await call("POST", "/api/projects/clone", { ...base, targetPath: full })).toEqual({
      status: 409,
      json: { error: "target_path_not_empty" },
    });
    const taken = await createProject({ name: "Taken", repoPath: join(tmp, "taken"), slug: "taken" });
    expect(await call("POST", "/api/projects/clone", { ...base, targetPath: taken.repoPath })).toEqual({
      status: 409,
      json: { error: "project_path_exists" },
    });
  });

  it("PATCH /projects/:id", async () => {
    const p = await createProject({ name: "Patch", repoPath: gitDir("patch"), slug: "patch-codes" });
    await createProject({ name: "Other", repoPath: gitDir("other"), slug: "other-codes" });
    expect(await call("PATCH", `/api/projects/${p.id}`, { repoPath: "rel" })).toEqual({
      status: 400,
      json: { error: "repo_path_not_absolute" },
    });
    expect(await call("PATCH", `/api/projects/${p.id}`, { repoPath: join(tmp, "no-git") })).toEqual({
      status: 400,
      json: { error: "repo_path_not_git" },
    });
    expect((await call("PATCH", `/api/projects/${p.id}`, { slug: "-bad" })).json.error).toBe("invalid_slug");
    expect(await call("PATCH", `/api/projects/${p.id}`, { slug: "other-codes" })).toEqual({
      status: 409,
      json: { error: "slug_in_use" },
    });
  });

  it("GitHub routes", async () => {
    expect(await call("GET", "/api/github/prs/1/diff")).toEqual({
      status: 400,
      json: { error: "project_id_required" },
    });
    expect(await call("GET", "/api/github/prs/1/diff?projectId=proj_missing")).toEqual({
      status: 404,
      json: { error: "project_not_found" },
    });
    expect(await call("GET", "/api/github/prs/abc/diff?projectId=x")).toEqual({
      status: 400,
      json: { error: "invalid_pr_number" },
    });
  });
});

describe("zincir F0.5: base branch must exist in an existing repo (plan §5.0)", () => {
  it("POST: existing repo + missing branch → 422 + detected; right branch, unborn repo and new repo → 201", async () => {
    const repo = makeRepo("clauflow-codes-bb-");
    try {
      expect(
        await call("POST", "/api/projects", { name: "BB1", repoPath: repo, defaultBranch: "master", slug: "bb-one" }),
      ).toEqual({ status: 422, json: { error: "base_branch_missing", detected: "main" } });
      const ok = await call("POST", "/api/projects", { name: "BB1", repoPath: repo, defaultBranch: "main", slug: "bb-one" });
      expect(ok.status).toBe(201);
      expect(ok.json.project.defaultBranch).toBe("main");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }

    const unborn = join(tmp, "unborn");
    mkdirSync(unborn, { recursive: true });
    git(unborn, "init", "-q", "-b", "main");
    const u = await call("POST", "/api/projects", { name: "BB2", repoPath: unborn, defaultBranch: "master", slug: "bb-two" });
    expect(u.status).toBe(201);

    const fresh = join(tmp, "fresh-trunk");
    const f = await call("POST", "/api/projects", { name: "BB3", repoPath: fresh, defaultBranch: "trunk", slug: "bb-three" });
    expect(f.status).toBe(201);
    expect(git(fresh, "rev-parse", "--abbrev-ref", "HEAD")).toBe("trunk");
  });

  it("PATCH: defaultBranch alone and repoPath + defaultBranch together are validated at the target repo", async () => {
    const a = makeRepo("clauflow-codes-bba-");
    const b = makeRepo("clauflow-codes-bbb-");
    git(b, "branch", "-m", "main", "trunk");
    try {
      const p = await createProject({ name: "BBP", repoPath: a, defaultBranch: "main", slug: "bb-patch" });
      expect(await call("PATCH", `/api/projects/${p.id}`, { defaultBranch: "master" })).toEqual({
        status: 422,
        json: { error: "base_branch_missing", detected: "main" },
      });
      expect(await call("PATCH", `/api/projects/${p.id}`, { repoPath: b })).toEqual({
        status: 422,
        json: { error: "base_branch_missing", detected: "trunk" },
      });
      expect(await call("PATCH", `/api/projects/${p.id}`, { repoPath: b, defaultBranch: "main" })).toEqual({
        status: 422,
        json: { error: "base_branch_missing", detected: "trunk" },
      });
      expect((await getProject(p.id))!.repoPath).toBe(a);
      const ok = await call("PATCH", `/api/projects/${p.id}`, { repoPath: b, defaultBranch: "trunk" });
      expect(ok.status).toBe(200);
      expect(ok.json.project.defaultBranch).toBe("trunk");
      expect((await call("PATCH", `/api/projects/${p.id}`, { name: "renamed" })).status).toBe(200);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("D8: repo path lock", () => {
  it("only doing tasks and review tasks with a branch block a repoPath change", async () => {
    const p = await createProject({ name: "Lock", repoPath: gitDir("lock"), slug: "lock" });
    const next = gitDir("lock-next");
    const seed = await createTask({ projectId: p.id, title: "seed" });
    await updateTask(seed.id, { status: "review", branch: null });
    await updateTask((await createTask({ projectId: p.id, title: "done" })).id, {
      status: "done",
      branch: "feature/old",
    });
    expect(await projectHasActiveTasks(p.id)).toBe(false);
    const ok = await call("PATCH", `/api/projects/${p.id}`, { repoPath: next });
    expect(ok.status).toBe(200);
    expect(ok.json.project.repoPath).toBe(next);

    const review = await createTask({ projectId: p.id, title: "review" });
    await updateTask(review.id, { status: "review", branch: "feature/x" });
    expect(await projectHasActiveTasks(p.id)).toBe(true);
    expect(await call("PATCH", `/api/projects/${p.id}`, { defaultBranch: "dev" })).toEqual({
      status: 409,
      json: { error: "active_tasks_block_path_change" },
    });

    await updateTask(review.id, { status: "done" });
    expect(await projectHasActiveTasks(p.id)).toBe(false);
    await updateTask(seed.id, { status: "doing" });
    expect(await projectHasActiveTasks(p.id)).toBe(true);
  });
});
