import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-chainpaths-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-chainpaths-gh-${stamp}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTask, getProject, getTask, updateTask } from "../services/taskService.js";
import { installChainHooks, uninstallChainHooks } from "../services/chainService.js";
import { addBareOrigin, installFakeGh } from "../test-utils/fakeGh.js";
import { FAKE_CLAUDE, git, makeRepo, readCalls, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import githubRouter from "../routes/github.js";
import tasksRouter from "../routes/tasks.js";
import { run as runExecutor, waitForIdle } from "./executor.js";
import type { Task } from "../types/index.js";

/**
 * zincir F2 (plan §3/3, Z13): every "→ done" path starts the waiting dependent.
 * Real executor + fake CLI; the dependent's start is observed through its state
 * (it leaves `waiting_deps` and its own run reaches the end). The broken-down
 * parent path is covered in F3 (plan §3/7).
 */

let server: TestServer;
const dirs: string[] = [];
let state = "";
let n = 0;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

/** A (optionally already in review on its own branch) and B waiting for A. */
async function setup(opts: { aInReview?: boolean; remote?: boolean } = {}) {
  n += 1;
  const repo = makeRepo("clauflow-chainpaths-");
  dirs.push(repo);
  if (opts.remote) dirs.push(addBareOrigin(repo));
  const project = await createProject({
    name: `cp ${n}`,
    repoPath: repo,
    defaultBranch: "main",
    slug: `cp${n}${Date.now().toString(36)}`,
    defaultTeamId: null,
  });
  let a = await createTask({ projectId: project.id, title: "A" });
  const branch = `feature/${a.displayId!.toLowerCase()}-a`;
  if (opts.aInReview) {
    git(repo, "checkout", "-q", "-b", branch);
    writeRepoFile(repo, "a.txt", "from A\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "feat: a");
    if (opts.remote) git(repo, "push", "-q", "origin", branch);
    git(repo, "checkout", "-q", "main");
    a = await updateTask(a.id, { status: "review", branch });
  }
  const b = await createTask({ projectId: project.id, title: "B", dependsOn: [a.id] });
  const waiting = await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", uiLang: "en" });
  expect(waiting.json.task.agent.status).toBe("waiting_deps");
  return { repo, project, a, b };
}

/** B left waiting_deps (claimed + enqueued), then its own run finished. */
async function expectDependentRan(b: Task, finalStatus: "review" | "done" = "review") {
  await vi.waitFor(
    async () => expect((await getTask(b.id))!.agent.status).not.toBe("waiting_deps"),
    { timeout: 5000, interval: 20 },
  );
  await waitForIdle(b.id, 30_000);
  const fresh = (await getTask(b.id))!;
  expect(fresh.status).toBe(finalStatus);
  expect(fresh.agent.log.length).toBeGreaterThan(0);
  return fresh;
}

beforeAll(async () => {
  installChainHooks();
  server = await startTestServer([
    ["/api/tasks", tasksRouter],
    ["/api/github", githubRouter],
  ]);
});

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "clauflow-chainpaths-state-"));
  dirs.push(state);
  process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FAKE_CLAUDE_STATE = state;
  process.env.FAKE_CLAUDE_SCENARIO = "pass";
});

afterAll(async () => {
  uninstallChainHooks();
  await server.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("every → done path starts the waiting dependent (zincir F2, Z13)", () => {
  it("Review → Done local merge (PATCH)", async () => {
    const { repo, a, b } = await setup({ aInReview: true });
    const r = await call("PATCH", `/api/tasks/${a.id}`, { status: "done" });
    expect(r.status).toBe(200);
    const fresh = await expectDependentRan(b);
    // B branched after A's merge commit.
    const mergeCommit = git(repo, "rev-parse", "main");
    git(repo, "merge-base", "--is-ancestor", mergeCommit, fresh.branch!);
  });

  it("approval dialog todo → done (PATCH)", async () => {
    const { a, b } = await setup();
    const r = await call("PATCH", `/api/tasks/${a.id}`, { status: "done" });
    expect(r.status).toBe(200);
    expect(r.json.task.status).toBe("done");
    await expectDependentRan(b);
  });

  it("PR drawer merge (POST /api/github/prs/:n/merge, fake gh)", async () => {
    const gh = installFakeGh();
    try {
      const { project, a, b } = await setup({ aInReview: true, remote: true });
      await updateTask(a.id, { prNumber: 5, prUrl: "https://github.com/acme/fake/pull/5" });
      const r = await call("POST", `/api/github/prs/5/merge?projectId=${project.id}`);
      expect(r).toEqual({ status: 200, json: { success: true } });
      expect((await getTask(a.id))!.status).toBe("done");
      await expectDependentRan(b);
      expect(gh.calls()[0]).toBe("pr merge 5 --merge --delete-branch");
    } finally {
      gh.restore();
    }
  });

  it("a run with no changes closes A as done (executor, no_change)", async () => {
    process.env.FAKE_CLAUDE_SCENARIO = "no_change";
    const { project, a, b } = await setup();
    const doing = await updateTask(a.id, { status: "doing" });
    await runExecutor(doing, (await getProject(project.id))!);
    expect((await getTask(a.id))!.status).toBe("done");
    // B runs with the same scenario: no changes either, so it is done too.
    await expectDependentRan(b, "done");
    expect(readCalls(state).length).toBeGreaterThanOrEqual(2);
  });
});
