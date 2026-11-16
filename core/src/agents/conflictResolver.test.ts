import { afterAll, afterEach, describe, expect, it, vi, type Mock } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-resolver-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-resolver-gh-${stamp}`;
});

// Keep the real broadcasts, but observe `stash_created` (§3/40, §5.7).
vi.mock("../services/wsService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/wsService.js")>();
  return { ...actual, broadcastStashCreated: vi.fn() };
});

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  abortResolution,
  baseDrift,
  isResolving,
  mergedTasksSince,
  resolverPhase,
  startResolution,
} from "./conflictResolver.js";
import { findConflictMarkers } from "./conflictMarkers.js";
import { buildConflictSystemMarker } from "./teamPrompts.js";
import { getComments } from "../services/commentService.js";
import { liveProcessGroups } from "../services/claudeService.js";
import { getRepoLockHolder, getRepoLockQueue, tryAcquireRepoLock } from "../services/repoLock.js";
import { createTask, getTask, listNodeRunsByTask, listTasks, updateTask } from "../services/taskService.js";
import { getTeam } from "../services/teamService.js";
import { BUILTIN_TEAM_IDS, defaultRole } from "../services/teamTemplates.js";
import { broadcastStashCreated } from "../services/wsService.js";
import { addBareOrigin, installFakeGh } from "../test-utils/fakeGh.js";
import { git, processGone, readCalls, readHangPids, writeRepoFile } from "../test-utils/fakeRepo.js";
import { cleanupTeamCases, makeTeamCase, type TeamCase } from "../test-utils/teamHarness.js";
import type { Task } from "../types/index.js";

const stashSpy = broadcastStashCreated as unknown as Mock;
const extraDirs: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await sleep(20);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  stashSpy.mockClear();
});

afterAll(() => {
  cleanupTeamCases();
  for (const d of extraDirs.splice(0)) {
    try {
      execFileSync("chmod", ["-R", "u+w", d]);
    } catch {
      // ignore
    }
    rmSync(d, { recursive: true, force: true });
  }
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

interface ConflictCase extends TeamCase {
  /** The task that was merged into main first (A). */
  merged: Task;
  /** The resolved task's branch (B) and its SHA before the run. */
  branch: string;
  pre: string;
  origin: string | null;
}

/**
 * Two sibling branches off the same base: A changed `shared.txt`'s line and
 * was merged into main (`Merge <branch> (<id>)`); B (the case's task, in
 * review) changed the same line (`clean`: another file instead).
 */
async function conflictCase(
  opts: {
    scenario?: string;
    teamId?: string | null;
    budgetUsd?: number;
    clean?: boolean;
    remote?: boolean;
  } = {},
): Promise<ConflictCase> {
  const c = await makeTeamCase({
    scenario: opts.scenario ?? "pass",
    teamId: opts.teamId === undefined ? BUILTIN_TEAM_IDS.yazilimEkibi : opts.teamId,
    project: { defaultTeamId: null },
    title: "Say hello from B",
    budgetUsd: opts.budgetUsd,
    setupRepo: (repo) => {
      writeRepoFile(repo, "shared.txt", "base line\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "seed shared.txt");
    },
  });
  const repo = c.repo;
  const base0 = git(repo, "rev-parse", "HEAD");

  const merged = await createTask({
    projectId: c.project.id,
    title: "Say hello from A",
    description: "A wants its own greeting on the shared line.",
  });
  const branchA = `feature/${merged.displayId!.toLowerCase()}-hello-a`;
  git(repo, "checkout", "-q", "-b", branchA);
  writeRepoFile(repo, "shared.txt", "line from A\n");
  git(repo, "commit", "-q", "-am", "feat: A");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--no-ff", "-m", `Merge ${branchA} (${merged.displayId})`, branchA);
  git(repo, "branch", "-q", "-D", branchA);

  const branch = `feature/${c.task.displayId!.toLowerCase()}-hello-b`;
  git(repo, "checkout", "-q", "-b", branch, base0);
  if (opts.clean) writeRepoFile(repo, "other.txt", "B's own file\n");
  else writeRepoFile(repo, "shared.txt", "line from B\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "feat: B");
  git(repo, "checkout", "-q", "main");

  let origin: string | null = null;
  if (opts.remote) {
    origin = addBareOrigin(repo);
    extraDirs.push(origin);
    git(repo, "push", "-q", "-u", "origin", branch);
  }

  const task = await updateTask(c.task.id, {
    status: "review",
    branch,
    agent: { status: "done", currentStep: undefined, error: null },
  });
  return { ...c, task, merged, branch, pre: git(repo, "rev-parse", branch), origin };
}

/** §6 / §3/40 post-conditions of every failed run. */
function expectRestored(c: ConflictCase): void {
  expect(git(c.repo, "rev-parse", c.branch)).toBe(c.pre);
  expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(git(c.repo, "status", "--porcelain")).toBe("");
  expect(git(c.repo, "for-each-ref", "refs/clauflow")).toBe("");
  expect(getRepoLockHolder(c.repo)).toBeNull();
  expect(isResolving(c.task.id)).toBe(false);
}

async function expectFailed(c: ConflictCase, reason: string): Promise<Task> {
  const t = (await getTask(c.task.id))!;
  expect(t.status).toBe("review");
  expect(t.agent.status).toBe("error");
  expect(t.agent.error).toBe(`conflict_unresolved:${reason}`);
  expect(t.agent.currentStep ?? null).toBeNull();
  expectRestored(c);
  return t;
}

const roleCalls = (c: TeamCase, role: string) => readCalls(c.state).filter((x) => x.role === role);
const lastComment = (taskId: string) => getComments(taskId).at(-1);

describe("conflict resolver service (zincir F4.6, §3/35–40, §5.10)", () => {
  it("(1) keep_both: review + done/conflict_resolved, two-parent merge commit, both lines, QA PASS, cost, node runs, summary", async () => {
    const c = await conflictCase();
    const before = (await getTask(c.task.id))!;
    const mainSha = git(c.repo, "rev-parse", "main");

    await startResolution(c.task.id, { mode: "conflict", trigger: "manual", uiLang: "tr" });

    const t = (await getTask(c.task.id))!;
    expect(t.status).toBe("review");
    expect(t.agent).toMatchObject({ status: "done", currentStep: "conflict_resolved", error: null });

    const parents = git(c.repo, "rev-list", "--parents", "-n", "1", c.branch).split(" ");
    expect(parents).toHaveLength(3);
    expect(parents[1]).toBe(c.pre);
    expect(parents[2]).toBe(mainSha);
    expect(git(c.repo, "log", "-1", "--format=%s", c.branch)).toBe(
      `Merge main into ${c.branch} (${c.task.displayId}): conflicts resolved by ClauFlow`,
    );
    const shared = git(c.repo, "show", `${c.branch}:shared.txt`);
    expect(shared).toContain("line from A");
    expect(shared).toContain("line from B");
    expect(findConflictMarkers(shared)).toEqual([]);
    // Never merged into base, base untouched.
    expect(git(c.repo, "rev-parse", "main")).toBe(mainSha);
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(git(c.repo, "for-each-ref", "refs/clauflow")).toBe("");
    expect(getRepoLockHolder(c.repo)).toBeNull();
    expect(isResolving(c.task.id)).toBe(false);

    expect(t.costUsd! - (before.costUsd ?? 0)).toBeCloseTo(0.02, 9);
    const runs = listNodeRunsByTask(c.task.id);
    const resolveRun = runs.find((r) => r.nodeId === "role:resolve:1")!;
    const qaRun = runs.find((r) => r.nodeId === "role:resolve-qa:1")!;
    expect(resolveRun).toMatchObject({ status: "done", nodeType: "developer" });
    expect(qaRun).toMatchObject({ status: "done", nodeType: "qa" });

    const comment = lastComment(c.task.id)!;
    expect(comment.status).toBe("done");
    expect(comment.body).toContain("## Çakışma çözücü");
    expect(comment.body).toContain("**Sonuç:** Çözüldü");
    expect(comment.body).toContain("PASS");
    expect(comment.body).toContain("`shared.txt`");
    expect(comment.body).toContain(c.merged.displayId!);

    const dev = getTeam(BUILTIN_TEAM_IDS.yazilimEkibi)!.roles.find((r) => r.kind === "developer")!;
    const [resolver] = roleCalls(c, "conflict_resolver");
    expect(resolver).toBeDefined();
    expect(resolver!.strictMcpConfig).toBe(true);
    expect(resolver!.settingSources).toBe("project,local");
    expect(resolver!.tools).toBe(dev.tools.join(","));
    expect(resolver!.model).toBe(dev.model);
    expect(resolver!.appendSystemPrompt!.startsWith(buildConflictSystemMarker(1))).toBe(true);
    expect(resolver!.prompt).toContain(`Title: ${c.task.title}`);
    expect(resolver!.prompt).toContain("File: shared.txt");
    expect(resolver!.prompt).toContain("<<<<<<<");
    expect(resolver!.prompt).toContain(`${c.merged.displayId} · ${c.merged.title}`);
    expect(resolver!.prompt).toContain("Write the note in Türkçe.");
    const [qa] = roleCalls(c, "qa");
    expect(qa!.prompt).toContain("<conflict_resolution>");
    expect(qa!.strictMcpConfig).toBe(true);

    expect(t.agent.log.some((l) => l.includes("✓ İşaretçi kalmadı"))).toBe(true);
    expect(t.agent.log.some((l) => l.includes("▸ QA kararı: PASS"))).toBe(true);
  });

  it("(2) leave_markers → conflict_unresolved:markers_left, branch back on its SHA", async () => {
    vi.stubEnv("FAKE_CLAUDE_RESOLVE", "leave_markers");
    const c = await conflictCase();
    await startResolution(c.task.id, { mode: "conflict", trigger: "auto" });
    const t = await expectFailed(c, "markers_left");
    expect(roleCalls(c, "qa")).toHaveLength(0);
    expect(t.agent.log.some((l) => l.includes(`↺ Dal geri yüklendi (${c.pre.slice(0, 7)})`))).toBe(true);
    const comment = lastComment(c.task.id)!;
    expect(comment.body).toContain("Not resolved (conflict markers left)");
  });

  it("(3) qa_fail → conflict_unresolved:qa_fail, the merge commit is undone", async () => {
    vi.stubEnv("FAKE_CLAUDE_RESOLVE", "qa_fail");
    const c = await conflictCase();
    await startResolution(c.task.id, { mode: "conflict", trigger: "auto", uiLang: "tr" });
    await expectFailed(c, "qa_fail");
    expect(roleCalls(c, "qa")).toHaveLength(1);
    expect(git(c.repo, "log", "--merges", "--format=%s", `main..${c.branch}`)).toBe("");
    expect(lastComment(c.task.id)!.body).toContain("**QA:** FAIL");
  });

  it("(4) hang + short timeout → conflict_unresolved:role_timeout, process tree dead", async () => {
    vi.stubEnv("CLAUFLOW_ROLE_TIMEOUT_MS", "300");
    vi.stubEnv("CLAUFLOW_KILL_GRACE_MS", "200");
    const c = await conflictCase({ scenario: "hang" });
    await startResolution(c.task.id, { mode: "conflict", trigger: "auto" });
    await expectFailed(c, "role_timeout");
    const pids = readHangPids(c.state);
    expect(pids).not.toBeNull();
    await until(() => processGone(pids!.cli) && processGone(pids!.grandchild), 2000);
    expect(liveProcessGroups()).toEqual([]);
  });

  it("(5) budget 0.005 with a 0.01 call → conflict_unresolved:budget, no QA", async () => {
    const c = await conflictCase({ budgetUsd: 0.005 });
    await startResolution(c.task.id, { mode: "conflict", trigger: "auto" });
    await expectFailed(c, "budget");
    expect(roleCalls(c, "conflict_resolver")).toHaveLength(1);
    expect(roleCalls(c, "qa")).toHaveLength(0);
  });

  it("(6) abort while running → conflict_unresolved:aborted, restored", async () => {
    vi.stubEnv("FAKE_CLAUDE_SLOW_MS", "30000");
    const c = await conflictCase({ scenario: "slow" });
    const run = startResolution(c.task.id, { mode: "conflict", trigger: "auto" });
    await until(() => roleCalls(c, "conflict_resolver").length === 1);
    expect(resolverPhase(c.task.id)).toBe("running");
    expect(abortResolution(c.task.id)).toBe(true);
    await run;
    await expectFailed(c, "aborted");
    expect(roleCalls(c, "qa")).toHaveLength(0);
  });

  it("(6b) abort while queued behind the lock → aborted, git untouched", async () => {
    const c = await conflictCase();
    const lease = tryAcquireRepoLock(c.repo, "someone-else")!;
    try {
      const run = startResolution(c.task.id, { mode: "conflict", trigger: "manual" });
      await until(() => getRepoLockQueue(c.repo).length === 1);
      expect(resolverPhase(c.task.id)).toBe("queued");
      expect((await getTask(c.task.id))!.agent).toMatchObject({ status: "resolving_conflict", currentStep: "queued" });
      expect(abortResolution(c.task.id)).toBe(true);
      await run;
    } finally {
      lease.release();
    }
    await expectFailed(c, "aborted");
    expect(readCalls(c.state)).toHaveLength(0);
  });

  it("(7) clean update → no AI, no QA, branch contains base, comment says QA skipped", async () => {
    const c = await conflictCase({ clean: true });
    const drift = await baseDrift(c.task, c.project);
    expect(drift).toMatchObject({ base: "main", target: "main", behind: 2 });

    await startResolution(c.task.id, { mode: "update", trigger: "manual", uiLang: "tr" });

    const t = (await getTask(c.task.id))!;
    expect(t.status).toBe("review");
    expect(t.agent).toMatchObject({ status: "done", currentStep: "conflict_resolved", error: null });
    expect(readCalls(c.state)).toHaveLength(0);
    execFileSync("git", ["merge-base", "--is-ancestor", "main", c.branch], { cwd: c.repo });
    expect(git(c.repo, "rev-list", "--parents", "-n", "1", c.branch).split(" ")).toHaveLength(3);
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(git(c.repo, "for-each-ref", "refs/clauflow")).toBe("");
    const body = lastComment(c.task.id)!.body;
    expect(body).toContain("Temiz birleşti");
    expect(body).toContain("QA atlandı");
    expect((await baseDrift(t, c.project)).behind).toBe(0);
  });

  it("(8) remote: fetch + merge origin/main, push --force-with-lease; a broken origin → push_failed, local branch restored", async () => {
    const gh = installFakeGh(7);
    try {
      const ok = await conflictCase({ remote: true });
      await startResolution(ok.task.id, { mode: "conflict", trigger: "auto" });
      expect((await getTask(ok.task.id))!.agent).toMatchObject({ status: "done", currentStep: "conflict_resolved" });
      expect(git(ok.origin!, "rev-parse", ok.branch)).toBe(git(ok.repo, "rev-parse", ok.branch));
      expect(git(ok.repo, "log", "-1", "--format=%s", ok.branch)).toContain(`Merge origin/main into ${ok.branch}`);
      expect(lastComment(ok.task.id)!.body).toContain("`origin/main`");

      const bad = await conflictCase({ remote: true });
      const originBefore = git(bad.origin!, "rev-parse", bad.branch);
      execFileSync("chmod", ["-R", "a-w", bad.origin!]);
      await startResolution(bad.task.id, { mode: "conflict", trigger: "auto" });
      execFileSync("chmod", ["-R", "u+w", bad.origin!]);
      await expectFailed(bad, "push_failed");
      expect(git(bad.origin!, "rev-parse", bad.branch)).toBe(originBefore);
    } finally {
      gh.restore();
    }
  });

  it("(9) Solo task → the QA round runs with defaultRole(\"qa\")", async () => {
    const c = await conflictCase({ teamId: null });
    await startResolution(c.task.id, { mode: "conflict", trigger: "auto" });
    expect((await getTask(c.task.id))!.agent.currentStep).toBe("conflict_resolved");
    const qaRole = defaultRole("qa");
    const [qa] = roleCalls(c, "qa");
    expect(qa).toBeDefined();
    expect(qa!.model).toBe(qaRole.model);
    expect(qa!.tools).toBe(qaRole.tools.join(","));
    expect(qa!.advisor).toBe(qaRole.advisorModel);
    const solo = getTeam(BUILTIN_TEAM_IDS.solo)!.roles[0]!;
    expect(roleCalls(c, "conflict_resolver")[0]!.tools).toBe(solo.tools.join(","));
  });

  it("(10) dirty tree → clauflow-resolve-<id> stash and stash_created reason resolve", async () => {
    const c = await conflictCase();
    writeRepoFile(c.repo, "scratch.txt", "user's unsaved work\n");
    await startResolution(c.task.id, { mode: "conflict", trigger: "auto" });
    expect((await getTask(c.task.id))!.agent.currentStep).toBe("conflict_resolved");
    const label = `clauflow-resolve-${c.task.id}`;
    expect(git(c.repo, "stash", "list")).toContain(label);
    expect(stashSpy).toHaveBeenCalledWith(
      c.task.id,
      expect.objectContaining({ label, reason: "resolve", projectId: c.project.id }),
    );
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(git(c.repo, "stash", "show", "-p", "--include-untracked", "stash@{0}")).toContain("user's unsaved work");
  });

  it("mergedTasksSince maps the base's merge commits to tasks (§3/37)", async () => {
    const c = await conflictCase();
    const tasks = (await listTasks(c.project.id)).filter((t) => t.id !== c.task.id);
    const found = await mergedTasksSince(c.repo, c.branch, "main", tasks);
    expect(found.map((t) => t.id)).toEqual([c.merged.id]);
    // Nothing merged since main's tip.
    expect(await mergedTasksSince(c.repo, "main", "main", tasks)).toEqual([]);
  });

  it("baseDrift: no branch → behind 0; reads origin/<base> when it exists (§3/46)", async () => {
    const c = await conflictCase({ remote: true });
    expect(await baseDrift({ branch: null }, c.project)).toMatchObject({ behind: 0, mergeBase: null });
    expect(await baseDrift({ branch: "feature/gone" }, c.project)).toMatchObject({ behind: 0 });
    const drift = await baseDrift(c.task, c.project);
    expect(drift.target).toBe("origin/main");
    expect(drift.behind).toBe(2);
    expect(drift.mergeBase).toBe(git(c.repo, "merge-base", c.branch, "origin/main"));
    // Read-only.
    expect(readFileSync(join(c.repo, ".git", "HEAD"), "utf8").trim()).toBe("ref: refs/heads/main");
  });
});
