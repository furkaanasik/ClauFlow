import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-commentiso-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-commentiso-gh-${stamp}`;
});

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runComment } from "./commentRunner.js";
import { buildCommentSystemMarker } from "./teamPrompts.js";
import { createComment, getComment } from "../services/commentService.js";
import { liveProcessGroups } from "../services/claudeService.js";
import { getRepoLockHolder } from "../services/repoLock.js";
import { getTask, listNodeRunsByTask, updateTask } from "../services/taskService.js";
import { getTeam } from "../services/teamService.js";
import { BUILTIN_TEAM_IDS } from "../services/teamTemplates.js";
import { git, processGone, readCalls, readHangPids } from "../test-utils/fakeRepo.js";
import { startTestServer } from "../test-utils/httpApp.js";
import { cleanupTeamCases, makeTeamCase, runTeamCase, type TeamCase } from "../test-utils/teamHarness.js";
import commentsRouter from "../routes/comments.js";

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
});

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

/** A Solo task in review with a one-commit feature branch; repo back on main. */
async function soloReviewCase(opts: { scenario?: string; budgetUsd?: number } = {}): Promise<TeamCase & { branch: string }> {
  const c = await makeTeamCase({ scenario: opts.scenario ?? "pass", project: { defaultTeamId: null }, budgetUsd: opts.budgetUsd });
  const branch = "feature/clf-1-review";
  git(c.repo, "checkout", "-q", "-b", branch);
  writeFileSync(join(c.repo, "work.txt"), "work\n");
  git(c.repo, "add", "-A");
  git(c.repo, "commit", "-q", "-m", "feat: work");
  git(c.repo, "checkout", "-q", "main");
  await updateTask(c.task.id, { status: "review", branch });
  return { ...c, branch };
}

const commentCalls = (state: string) => readCalls(state).filter((call) => call.role === "comment");

describe("comment round = the developer's next round (E7b, plan §3/30)", () => {
  it("Yazılım Ekibi task: team developer model and tools, isolated, task context, role:comment:<n> node run, cost once", async () => {
    const c = await makeTeamCase({ scenario: "pass", teamId: BUILTIN_TEAM_IDS.yazilimEkibi, project: { defaultTeamId: null } });
    const reviewed = await runTeamCase(c, { uiLang: "tr" });
    expect(reviewed.status).toBe("review");
    expect(reviewed.branch).toBeTruthy();
    const dev = getTeam(BUILTIN_TEAM_IDS.yazilimEkibi)!.roles.find((r) => r.kind === "developer")!;

    const before = (await getTask(c.task.id))!;
    const agentLogBefore = before.agent.log.length;
    const comment = createComment(c.task.id, "Please also strip emoji.");
    await runComment(comment, c.project, { uiLang: "tr" });
    await sleep(20);

    const done = getComment(comment.id)!;
    expect(done.status).toBe("done");
    expect(done.agentLog.join("\n")).toContain("yorum turu 1");
    // CLI output goes to the comment's log, not to the task's agent log.
    expect(done.agentLog).toContain("Feedback applied.");
    expect((await getTask(c.task.id))!.agent.log.length).toBe(agentLogBefore);

    const calls = commentCalls(c.state);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe(dev.model);
    expect(call.tools).toBe(dev.tools.join(","));
    expect(call.strictMcpConfig).toBe(true);
    expect(call.settingSources).toBe("project,local");
    expect(call.allowedTools).toBeNull();
    expect(call.advisor).toBe(dev.advisorModel);
    expect(call.appendSystemPrompt!.startsWith(buildCommentSystemMarker(1))).toBe(true);
    expect(call.prompt).toContain(`Title: ${c.task.title}`);
    expect(call.prompt).toContain("<specification>");
    expect(call.prompt).toContain("Last QA verdict: PASS");
    expect(call.prompt).toContain("<user_feedback>\nPlease also strip emoji.\n</user_feedback>");
    expect(call.prompt).toContain("Write any reply in Türkçe.");

    const nodeRuns = listNodeRunsByTask(c.task.id).filter((r) => r.nodeId.startsWith("role:comment:"));
    expect(nodeRuns.map((r) => r.nodeId)).toEqual(["role:comment:1"]);
    expect(nodeRuns[0]!.status).toBe("done");
    expect(nodeRuns[0]!.nodeType).toBe("developer");
    expect(nodeRuns[0]!.model).toBe(dev.model);
    expect(nodeRuns[0]!.costUsd).toBeCloseTo(0.01, 9);

    const after = (await getTask(c.task.id))!;
    expect(after.costUsd! - (before.costUsd ?? 0)).toBeCloseTo(0.01, 9);
    expect(after.usage!.inputTokens - before.usage!.inputTokens).toBe(100);
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "log", "--format=%s", "-1", reviewed.branch!)).toMatch(/user feedback applied/);

    // The next comment is round 2.
    const second = createComment(c.task.id, "One more tweak.");
    await runComment(second, c.project);
    expect(getComment(second.id)!.status).toBe("done");
    const runs = listNodeRunsByTask(c.task.id).filter((r) => r.nodeId.startsWith("role:comment:"));
    expect(runs.map((r) => r.nodeId).sort()).toEqual(["role:comment:1", "role:comment:2"]);
    const secondCall = commentCalls(c.state)[1]!;
    expect(secondCall.appendSystemPrompt!.startsWith(buildCommentSystemMarker(2))).toBe(true);
    expect(secondCall.prompt).toContain("Write any reply in English.");
  });

  it("Solo task: the Solo developer's model and tools, no spec / QA sections", async () => {
    const c = await soloReviewCase();
    const comment = createComment(c.task.id, "tweak");
    await runComment(comment, c.project);
    expect(getComment(comment.id)!.status).toBe("done");
    const solo = getTeam(BUILTIN_TEAM_IDS.solo)!.roles[0]!;
    const call = commentCalls(c.state)[0]!;
    expect(call.model).toBe(solo.model);
    expect(call.tools).toBe(solo.tools.join(","));
    expect(call.strictMcpConfig).toBe(true);
    expect(call.prompt).not.toContain("<specification>");
    expect(call.prompt).not.toContain("Last QA verdict");
  });

  it("budget 0.005 with a 0.01 call: comment error with stuck_budget, repo back on main", async () => {
    const c = await soloReviewCase({ budgetUsd: 0.005 });
    const comment = createComment(c.task.id, "expensive tweak");
    await runComment(comment, c.project);
    const done = getComment(comment.id)!;
    expect(done.status).toBe("error");
    expect(done.agentLog.join("\n")).toContain("[error] stuck_budget");
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(git(c.repo, "log", "--format=%s", "-1", c.branch)).toBe("feat: work");
    expect(getRepoLockHolder(c.repo)).toBeNull();
  });

  it("hang + short timeout: comment error with role_timeout:developer, lock free, repo on base, tree dead", async () => {
    vi.stubEnv("CLAUFLOW_ROLE_TIMEOUT_MS", "300");
    vi.stubEnv("CLAUFLOW_KILL_GRACE_MS", "200");
    const c = await soloReviewCase({ scenario: "hang" });
    const comment = createComment(c.task.id, "this one hangs");
    await runComment(comment, c.project);

    const done = getComment(comment.id)!;
    expect(done.status).toBe("error");
    const log = done.agentLog.join("\n");
    expect(log).toContain("[error] role_timeout:developer");
    expect(log).toMatch(/Zaman aşımı: developer/);
    expect(getRepoLockHolder(c.repo)).toBeNull();
    expect(git(c.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(c.repo, "status", "--porcelain")).toBe("");
    expect(git(c.repo, "stash", "list")).toContain(`clauflow-comment-${comment.id}`);
    const nodeRun = listNodeRunsByTask(c.task.id).find((r) => r.nodeId === "role:comment:1")!;
    expect(nodeRun.status).toBe("error");
    expect(nodeRun.errorMessage).toBe("role_timeout");

    const pids = readHangPids(c.state);
    expect(pids).not.toBeNull();
    await until(() => processGone(pids!.cli) && processGone(pids!.grandchild), 2000);
    expect(liveProcessGroups()).toEqual([]);
  });

  it("route: uiLang reaches the prompt; an unknown uiLang is 400", async () => {
    const c = await soloReviewCase();
    const server = await startTestServer([["/api/tasks/:id/comments", commentsRouter]]);
    const post = (payload: unknown) =>
      fetch(`${server.url}/api/tasks/${c.task.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    try {
      const bad = await post({ body: "x", uiLang: "de" });
      expect(bad.status).toBe(400);

      const ok = await post({ body: "türkçe yanıt", uiLang: "tr" });
      expect(ok.status).toBe(201);
      const { comment } = (await ok.json()) as { comment: { id: string } };
      await until(() => getComment(comment.id)!.status === "done");
      expect(commentCalls(c.state)[0]!.prompt).toContain("Write any reply in Türkçe.");
    } finally {
      await server.close();
    }
  });
});
