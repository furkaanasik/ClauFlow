import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-conflicte2e-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-conflicte2e-gh-${stamp}`;
});

const ws = vi.hoisted(() => ({ chainAdvanced: [] as Array<{ taskId: string; payload: any }> }));
vi.mock("../services/wsService.js", async (orig) => {
  const real = await orig<typeof import("../services/wsService.js")>();
  return {
    ...real,
    broadcastChainAdvanced: (taskId: string, payload: unknown) => {
      ws.chainAdvanced.push({ taskId, payload });
      real.broadcastChainAdvanced(taskId, payload as never);
    },
  };
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTask, getTask } from "../services/taskService.js";
import { installChainHooks, uninstallChainHooks } from "../services/chainService.js";
import { getRepoLockHolder } from "../services/repoLock.js";
import { FAKE_CLAUDE, git, makeRepo, readCalls, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import tasksRouter from "../routes/tasks.js";
import type { Task } from "../types/index.js";
import { isResolving } from "./conflictResolver.js";
import { isRunning, waitForIdle } from "./executor.js";

/**
 * zincir F4.6 (C5, C7): two sibling tasks change the same line of
 * `shared.txt` with the fake CLI and the real executor. A merges; B's Done
 * conflicts, the resolver starts by itself and brings B back to Review with
 * both lines; B then merges cleanly. A task waiting for B (C → B) keeps
 * waiting while B resolves (the resolver never writes `done`) and starts only
 * when B is really merged.
 */

let server: TestServer;
let state: string;
const dirs: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

async function until(id: string, pred: (t: Task) => boolean, ms = 20_000): Promise<Task> {
  await vi.waitFor(
    async () => {
      const t = (await getTask(id))!;
      expect(pred(t)).toBe(true);
    },
    { timeout: ms, interval: 25 },
  );
  return (await getTask(id))!;
}

/** C must sit untouched in `waiting_deps`: no run, no log, no branch. */
async function expectStillWaiting(id: string) {
  const t = (await getTask(id))!;
  expect(t).toMatchObject({ status: "doing", branch: null });
  expect(t.agent.status).toBe("waiting_deps");
  expect(t.agent.log).toEqual([]);
  expect(isRunning(id)).toBe(false);
}

beforeAll(async () => {
  state = mkdtempSync(join(tmpdir(), "clauflow-conflicte2e-state-"));
  dirs.push(state);
  process.env.CLAUFLOW_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FAKE_CLAUDE_STATE = state;
  process.env.FAKE_CLAUDE_SCENARIO = "pass";
  process.env.FAKE_CLAUDE_CONFLICT_FILE = "shared.txt";
  delete process.env.FAKE_CLAUDE_RESOLVE;
  installChainHooks();
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

afterAll(async () => {
  uninstallChainHooks();
  await server.close();
  delete process.env.FAKE_CLAUDE_CONFLICT_FILE;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

describe("conflict resolver end to end + chain (zincir F4.6, C5/C7)", () => {
  it("A merges, B conflicts and resolves by itself, C keeps waiting until B is really merged", async () => {
    const repo = makeRepo("clauflow-conflicte2e-");
    dirs.push(repo);
    writeRepoFile(repo, "shared.txt", "base line\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "seed shared.txt");
    const base0 = git(repo, "rev-parse", "HEAD");

    const project = await createProject({
      name: "conflict e2e",
      repoPath: repo,
      defaultBranch: "main",
      slug: `cf${Date.now().toString(36)}`,
      defaultTeamId: null,
    });
    const a = await createTask({ projectId: project.id, title: "A" });
    const b = await createTask({ projectId: project.id, title: "B" });
    const c = await createTask({ projectId: project.id, title: "C" });

    // C → B through the F1 endpoint; C waits as soon as it is dragged to Doing.
    const deps = await call("PUT", `/api/tasks/${c.id}/dependencies`, { dependsOn: [b.id] });
    expect(deps.status).toBe(200);
    expect(deps.json.task.dependsOn).toEqual([b.id]);
    const pc = await call("PATCH", `/api/tasks/${c.id}`, { status: "doing", uiLang: "en" });
    expect(pc.status).toBe(200);
    expect(pc.json.task.agent.status).toBe("waiting_deps");

    // A and B from the same base, both to Review.
    expect((await call("PATCH", `/api/tasks/${a.id}`, { status: "doing", uiLang: "en" })).status).toBe(200);
    expect((await call("PATCH", `/api/tasks/${b.id}`, { status: "doing", uiLang: "en" })).status).toBe(200);
    const aReview = await until(a.id, (t) => t.status === "review");
    const bReview = await until(b.id, (t) => t.status === "review");
    await waitForIdle(a.id, 10_000);
    await waitForIdle(b.id, 10_000);
    const branchA = aReview.branch!;
    const branchB = bReview.branch!;
    expect(branchA).toBeTruthy();
    expect(branchB).toBeTruthy();
    expect(git(repo, "merge-base", branchA, branchB)).toBe(base0);
    expect(git(repo, "show", `${branchA}:shared.txt`)).toBe(`line from ${branchA}`);
    expect(git(repo, "show", `${branchB}:shared.txt`)).toBe(`line from ${branchB}`);
    await expectStillWaiting(c.id);

    // A merges cleanly.
    const doneA = await call("PATCH", `/api/tasks/${a.id}`, { status: "done" });
    expect(doneA.status).toBe(200);
    expect(doneA.json.task.status).toBe("done");
    const mergeA = git(repo, "rev-parse", "main");
    expect(git(repo, "log", "-1", "--format=%s", mergeA)).toBe(`Merge ${branchA} (${a.displayId})`);

    // B conflicts on the same line: 409, the resolver starts by itself.
    const conflict = await call("PATCH", `/api/tasks/${b.id}`, { status: "done", uiLang: "en" });
    expect(conflict.status).toBe(409);
    expect(conflict.json).toEqual({ error: "merge_conflict", files: ["shared.txt"], resolving: true });
    expect((await getTask(b.id))!).toMatchObject({ status: "review" });
    expect((await getTask(b.id))!.agent.status).toBe("resolving_conflict");

    // While B resolves, C keeps waiting (sampled until the resolver settles).
    const start = Date.now();
    let samples = 0;
    for (;;) {
      await expectStillWaiting(c.id);
      samples++;
      const bt = (await getTask(b.id))!;
      if (bt.agent.status !== "resolving_conflict" && !isResolving(b.id)) break;
      if (Date.now() - start > 20_000) throw new Error("resolver did not settle");
      await sleep(25);
    }
    expect(samples).toBeGreaterThan(1);

    const resolved = (await getTask(b.id))!;
    expect(resolved, JSON.stringify(resolved.agent.error)).toMatchObject({ status: "review", branch: branchB });
    expect(resolved.agent).toMatchObject({ status: "done", error: null, currentStep: "conflict_resolved" });
    expect(readCalls(state).filter((x) => x.role === "conflict_resolver")).toHaveLength(1);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(getRepoLockHolder(repo)).toBeNull();

    // B's branch now contains A's merge and keeps both lines, no markers.
    git(repo, "merge-base", "--is-ancestor", mergeA, branchB);
    const sharedB = git(repo, "show", `${branchB}:shared.txt`);
    expect(sharedB).toContain(`line from ${branchA}`);
    expect(sharedB).toContain(`line from ${branchB}`);
    expect(sharedB).not.toMatch(/^(<{7}|={7}|>{7})/m);

    // After the resolution C still waits and no chain event went out.
    await expectStillWaiting(c.id);
    expect(ws.chainAdvanced).toEqual([]);

    // B is really merged now: clean 200, and the done trigger starts C.
    const doneB = await call("PATCH", `/api/tasks/${b.id}`, { status: "done" });
    expect(doneB.status).toBe(200);
    expect(doneB.json.task).toMatchObject({ status: "done", branch: null });
    expect(git(repo, "log", "--merges", "--first-parent", "--format=%s", "main").split("\n")).toEqual([
      `Merge ${branchB} (${b.displayId})`,
      `Merge ${branchA} (${a.displayId})`,
    ]);
    const mergeB = git(repo, "rev-parse", "main");
    const sharedMain = git(repo, "show", "main:shared.txt");
    expect(sharedMain).toContain(`line from ${branchA}`);
    expect(sharedMain).toContain(`line from ${branchB}`);

    expect(ws.chainAdvanced).toHaveLength(1);
    expect(ws.chainAdvanced[0]).toMatchObject({
      taskId: b.id,
      payload: { projectId: project.id, merged: true, started: [{ id: c.id, displayId: c.displayId }] },
    });

    const cReview = await until(c.id, (t) => t.status === "review");
    await waitForIdle(c.id, 10_000);
    expect(cReview.branch).toBeTruthy();
    git(repo, "merge-base", "--is-ancestor", mergeB, cReview.branch!);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(getRepoLockHolder(repo)).toBeNull();
  }, 90_000);
});
