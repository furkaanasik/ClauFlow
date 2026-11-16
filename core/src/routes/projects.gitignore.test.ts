import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-gitignore-${process.pid}-${Date.now()}`;
  // `git init` repos made by the route have no local identity.
  process.env.GIT_AUTHOR_NAME = "ClauFlow Test";
  process.env.GIT_AUTHOR_EMAIL = "fake@clauflow.test";
  process.env.GIT_COMMITTER_NAME = "ClauFlow Test";
  process.env.GIT_COMMITTER_EMAIL = "fake@clauflow.test";
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "commit.gpgsign";
  process.env.GIT_CONFIG_VALUE_0 = "false";
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXCLUDE_BLOCK_START } from "../services/gitService.js";
import { DEFAULT_GITIGNORE } from "../services/noisePaths.js";
import { prepareRepoForGithub } from "../services/repoSetup.js";
import { git, makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import projectsRouter from "./projects.js";

// bakim #7 (plan §3/9): default ignores for new folders and existing repos.

let server: TestServer;
const dirs: string[] = [];
let n = 0;

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function put(root: string, rel: string, body = "x\n"): void {
  const f = join(root, rel);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, body);
}

async function createVia(repoPath: string) {
  n += 1;
  const res = await fetch(`${server.url}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `gi ${n}`, repoPath, slug: `gi${n}${Date.now().toString(36)}` }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const firstCommitFiles = (r: string) =>
  git(r, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
const exclude = (r: string) => {
  const f = join(r, ".git", "info", "exclude");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

beforeAll(async () => {
  server = await startTestServer([["/api/projects", projectsRouter]]);
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("ensureLocalRepo default ignores", () => {
  it("(a) a path that does not exist → .gitignore + README in the first commit, clean tree", async () => {
    const repo = join(tmp("clauflow-gi-a-"), "new-project");
    const r = await createVia(repo);
    expect(r.status).toBe(201);
    expect(firstCommitFiles(repo)).toEqual([".gitignore", "README.md"]);
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(DEFAULT_GITIGNORE);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("(b) a full folder without .git → first commit leaves node_modules and .env out", async () => {
    const repo = tmp("clauflow-gi-b-");
    put(repo, "node_modules/x.js");
    put(repo, "src/a.ts", "export const a = 1;\n");
    put(repo, ".env", "SECRET=1\n");
    put(repo, ".env.example", "SECRET=\n");

    const r = await createVia(repo);

    expect(r.status).toBe(201);
    expect(firstCommitFiles(repo)).toEqual([".env.example", ".gitignore", "README.md", "src/a.ts"]);
    expect(existsSync(join(repo, "node_modules", "x.js"))).toBe(true);
    expect(existsSync(join(repo, ".env"))).toBe(true);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("(c) a folder without .git but with its own .gitignore → the file stays byte for byte", async () => {
    const repo = tmp("clauflow-gi-c-");
    const own = "# mine\n*.tmp\n";
    put(repo, ".gitignore", own);
    put(repo, "src/a.ts");

    const r = await createVia(repo);

    expect(r.status).toBe(201);
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(own);
    expect(firstCommitFiles(repo)).toEqual([".gitignore", "README.md", "src/a.ts"]);
    expect(exclude(repo)).not.toContain(EXCLUDE_BLOCK_START);
  });

  it("(d) an existing repo without .gitignore → no file, no commit, clean tree, exclude block", async () => {
    const repo = makeRepo("clauflow-gi-d-");
    dirs.push(repo);
    const head = git(repo, "rev-parse", "HEAD");
    put(repo, "node_modules/y.js");

    const r = await createVia(repo);

    expect(r.status).toBe(201);
    expect(existsSync(join(repo, ".gitignore"))).toBe(false);
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo, "status", "--porcelain")).toBe("");
    const ex = exclude(repo);
    expect(ex).toContain(EXCLUDE_BLOCK_START);
    expect(ex).toContain("\nnode_modules/\n");
    expect(ex).toContain("\n!.env.example\n");
  });

  it("(e) an existing repo with .gitignore → nothing changes", async () => {
    const repo = makeRepo("clauflow-gi-e-");
    dirs.push(repo);
    put(repo, ".gitignore", "dist/\n");
    git(repo, "add", ".gitignore");
    git(repo, "commit", "-q", "-m", "ignore");
    const head = git(repo, "rev-parse", "HEAD");
    const before = exclude(repo);

    const r = await createVia(repo);

    expect(r.status).toBe(201);
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("dist/\n");
    expect(exclude(repo)).toBe(before);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});

describe("prepareRepoForGithub (createGithubRepo path, gh not called)", () => {
  it("a full folder without .git → .gitignore written and committed, node_modules left out", async () => {
    const repo = tmp("clauflow-gi-gh-");
    put(repo, "node_modules/x.js");
    put(repo, "src/a.ts");

    await prepareRepoForGithub(repo, "gh project");

    expect(firstCommitFiles(repo)).toEqual([".gitignore", "README.md", "src/a.ts"]);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("an existing repo without .gitignore → exclude block, no .gitignore file; a clean tree is fine", async () => {
    const repo = makeRepo("clauflow-gi-gh2-");
    dirs.push(repo);
    put(repo, "node_modules/x.js");
    const head = git(repo, "rev-parse", "HEAD");

    await prepareRepoForGithub(repo, "gh project");

    expect(existsSync(join(repo, ".gitignore"))).toBe(false);
    expect(exclude(repo)).toContain(EXCLUDE_BLOCK_START);
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});
