import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, db } from "../services/taskService.js";
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
  it("GET /claude/agents lists without bootstrapping main.md or settings.json and without commits", async () => {
    const before = git("rev-parse", "HEAD");
    const res = await call("GET", `/api/projects/${projectId}/claude/agents`);
    expect(res.status).toBe(200);
    expect(res.json.agents.map((a: { slug: string }) => a.slug)).toEqual(["coder"]);
    expect(git("status", "--porcelain")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(existsSync(join(repo, ".claude", "agents", "main.md"))).toBe(false);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
  });

  it("POST /claude/agents does not write settings.json", async () => {
    const res = await call("POST", `/api/projects/${projectId}/claude/agents`, { slug: "tester", body: "Test." });
    expect(res.status).toBe(201);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(false);
    expect(git("show", "--name-only", "--format=", "HEAD").split("\n")).toEqual([".claude/agents/tester.md"]);
  });

  it("PUT /claude/graph writes the file but does not commit", async () => {
    const before = git("rev-parse", "HEAD");
    const res = await call("PUT", `/api/projects/${projectId}/claude/graph`, { nodes: [], edges: [] });
    expect(res.status).toBe(200);
    expect(git("rev-parse", "HEAD")).toBe(before);
    git("clean", "-fdq");
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
});
