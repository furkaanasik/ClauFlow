import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-hasRemote-${process.pid}-${Date.now()}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../services/taskService.js";
import { HAS_REMOTE_TTL_MS, invalidateHasRemote, repoHasRemote } from "../services/remoteInfo.js";
import { git, makeRepo } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import projectsRouter from "./projects.js";

let server: TestServer;
const dirs: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

function repo(withRemote: boolean): string {
  const dir = makeRepo("clauflow-hasremote-");
  dirs.push(dir);
  if (withRemote) {
    const bare = mkdtempSync(join(tmpdir(), "clauflow-hasremote-origin-"));
    dirs.push(bare);
    git(bare, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", bare);
  }
  return dir;
}

beforeAll(async () => {
  server = await startTestServer([["/api/projects", projectsRouter]]);
});

afterAll(async () => {
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("hasRemote (plan §3/8)", () => {
  it("is derived from `git remote` on list and single reads; the stored `remote` column is ignored", async () => {
    const local = await createProject({ name: "local", repoPath: repo(false), defaultBranch: "main", remote: "git@x:stale.git" });
    const remote = await createProject({ name: "remote", repoPath: repo(true), defaultBranch: "main", remote: null });

    const list = await call("GET", "/api/projects");
    const byId = new Map((list.json.projects as Array<{ id: string; hasRemote: boolean }>).map((p) => [p.id, p]));
    expect(byId.get(local.id)!.hasRemote).toBe(false);
    expect(byId.get(remote.id)!.hasRemote).toBe(true);

    expect((await call("GET", `/api/projects/${local.id}`)).json.project.hasRemote).toBe(false);
    expect((await call("GET", `/api/projects/${remote.id}`)).json.project.hasRemote).toBe(true);
  });

  it("caches for 30 s, and a project update that changes repoPath drops the cache", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const dir = repo(false);
      const p = await createProject({ name: "cached", repoPath: dir, defaultBranch: "main" });
      expect((await call("GET", `/api/projects/${p.id}`)).json.project.hasRemote).toBe(false);

      const bare = mkdtempSync(join(tmpdir(), "clauflow-hasremote-origin-"));
      dirs.push(bare);
      git(bare, "init", "-q", "--bare");
      git(dir, "remote", "add", "origin", bare);
      // Still cached.
      expect((await call("GET", `/api/projects/${p.id}`)).json.project.hasRemote).toBe(false);
      vi.setSystemTime(Date.now() + HAS_REMOTE_TTL_MS + 1);
      expect((await call("GET", `/api/projects/${p.id}`)).json.project.hasRemote).toBe(true);

      // PATCH repoPath to a remote-less repo: answered fresh, not from the old entry.
      const other = repo(false);
      await repoHasRemote(other);
      git(other, "remote", "add", "origin", bare);
      const patched = await call("PATCH", `/api/projects/${p.id}`, { repoPath: other });
      expect(patched.status).toBe(200);
      expect(patched.json.project.hasRemote).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a missing folder is not a remote", async () => {
    invalidateHasRemote();
    expect(await repoHasRemote(join(tmpdir(), `clauflow-missing-${Date.now()}`))).toBe(false);
  });
});
