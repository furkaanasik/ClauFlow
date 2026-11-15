import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Own throwaway DB: never touch the shared core/data/tasks.db (dev server, master).
vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-projectsClaude-repoWrites-${process.pid}-${Date.now()}`;
});
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, db } from "../services/taskService.js";
import { acquireRepoLock, getRepoLockHolder } from "../services/repoLock.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import projectsClaudeRouter from "./projectsClaude.js";

const SUFFIX = `repowrites_${Date.now()}`;
let server: TestServer;
let tmp = "";
let repo = "";
let projectId = "";

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ekipler-repowrites-"));
  repo = join(tmp, "repo");
  mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(repo, ".claude", "agents", "coder.md"), "---\nname: Coder\n---\nWrite code.\n");
  writeFileSync(join(repo, "CLAUDE.md"), "# Old\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  projectId = (
    await createProject({ name: `RepoWrites ${SUFFIX}`, repoPath: repo, slug: SUFFIX.replace(/_/g, "-") })
  ).id;
  server = await startTestServer([["/api/projects", projectsClaudeRouter]]);
});

afterAll(async () => {
  await server.close();
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
  rmSync(tmp, { recursive: true, force: true });
});

describe("Claude config routes do not write to the repo on their own", () => {
  it("Studio agent, graph and push endpoints are gone", async () => {
    const before = git("rev-parse", "HEAD");
    const base = `/api/projects/${projectId}/claude`;
    const calls: Array<[string, string, unknown?]> = [
      ["GET", `${base}/agents`],
      ["GET", `${base}/agents/coder`],
      ["POST", `${base}/agents`, { slug: "tester", body: "Test." }],
      ["PUT", `${base}/agents/coder`, { body: "x" }],
      ["DELETE", `${base}/agents/coder`],
      ["POST", `${base}/agents/studio/generate`, { prompt: "x" }],
      ["GET", `${base}/graph`],
      ["PUT", `${base}/graph`, { nodes: [], edges: [] }],
      ["POST", `${base}/push`],
    ];
    for (const [method, path, body] of calls) {
      const res = await fetch(`${server.url}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(git("status", "--porcelain")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(before);
  });

  it("PUT /claude/instructions commits only on the base branch", async () => {
    git("checkout", "-q", "-b", "kanban/task-x");
    const before = git("rev-parse", "HEAD");
    const onTask = await call("PUT", `/api/projects/${projectId}/claude/instructions`, { content: "# On task\n" });
    expect(onTask.json).toMatchObject({ committed: false, commitWarning: "not_on_default_branch" });
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe("# On task\n");
    git("checkout", "-q", "--", "CLAUDE.md");
    git("checkout", "-q", "main");

    const onBase = await call("PUT", `/api/projects/${projectId}/claude/instructions`, { content: "# On base\n" });
    expect(onBase.json).toMatchObject({ committed: true, commitWarning: null });
    expect(git("log", "-1", "--format=%s")).toBe("chore: update CLAUDE.md");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("PUT /claude/instructions answers 409 repo_busy and writes nothing while the repo is locked (A1g)", async () => {
    const before = git("rev-parse", "HEAD");
    const content = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    const lease = await acquireRepoLock(repo, { owner: "task:running:tok" });
    try {
      const busy = await call("PUT", `/api/projects/${projectId}/claude/instructions`, { content: "# During a run\n" });
      expect(busy.status).toBe(409);
      expect(busy.json).toEqual({ error: "repo_busy" });
      expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(content);
      expect(git("status", "--porcelain")).toBe("");
      expect(git("rev-parse", "HEAD")).toBe(before);
    } finally {
      lease.release();
    }
    const free = await call("PUT", `/api/projects/${projectId}/claude/instructions`, { content: "# After the run\n" });
    expect(free.status).toBe(200);
    expect(free.json).toMatchObject({ committed: true });
    expect(getRepoLockHolder(repo)).toBeNull();
  });
});

afterAll(async () => {
  const { rmSync } = await import("node:fs");
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});
