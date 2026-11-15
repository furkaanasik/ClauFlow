import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-teamrun-c-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-teamrun-c-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import tasksRouter from "../routes/tasks.js";
import { getTask, recoverOrphanedTasks } from "../services/taskService.js";
import { ADVISOR_SUPPORTED } from "../services/claudeCapabilities.js";
import { createTeam } from "../services/teamService.js";
import { BUILTIN_TEAM_IDS, defaultRole } from "../services/teamTemplates.js";
import { git, writeRepoFile } from "../test-utils/fakeRepo.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase, type TeamCase } from "../test-utils/teamHarness.js";
import { ROLE_SETTING_SOURCES } from "./roleRunner.js";
import { buildPrTeamSection } from "./teamRunner.js";
import { getTeam } from "../services/teamService.js";
import type { TeamRun } from "../types/index.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer([["/api/tasks", tasksRouter]]);
});

afterAll(async () => {
  await server.close();
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

async function post(path: string, body: unknown = {}) {
  const res = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function waitForStatus(c: TeamCase, status: string) {
  for (let i = 0; i < 200; i++) {
    const t = await getTask(c.task.id);
    if (t?.status === status && t.agent.status !== "idle" && t.agent.status !== "running") return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`task never reached ${status}`);
}

describe("team run C: Keşif, approval gate, CLI arguments", () => {
  it("Keşif: no commits, no branch, summary comment, task done", async () => {
    const c = await makeTeamCase({ teamId: BUILTIN_TEAM_IDS.kesif });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(r.roles).toEqual(["ceo:1", "analyst:1"]);
    expect(task.status).toBe("done");
    expect(task.agent.status).toBe("done");
    expect(task.prUrl ?? null).toBeNull();
    expect(task.branch ?? null).toBeNull();
    expect(r.branches).toEqual([]);
    expect(r.currentBranch).toBe("main");
    expect(git(c.repo, "rev-parse", "HEAD")).toBe(c.initialHead);
    expect(r.runs[0]).toMatchObject({ status: "explored", teamId: BUILTIN_TEAM_IDS.kesif });
    const summary = r.comments.find((x) => x.body.startsWith("## Ekip özeti"))!;
    expect(summary.body).toContain("Keşif tamamlandı");
    expect(summary.body).toContain("## Brief");
    expect(summary.body).toContain("## Şartname");
  });

  it("approval gate: pauses after the analyst, survives orphan recovery, resumes with the edited spec", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { specApproval: true } });
    const paused = await runTeamCase(c);
    let r = inspect(c);

    expect(r.roles).toEqual(["ceo:1", "analyst:1"]);
    expect(paused.status).toBe("doing");
    expect(paused.agent.status).toBe("awaiting_approval");
    expect(r.runs[0]!.status).toBe("awaiting_approval");
    expect(r.branches).toEqual([]);
    expect(r.currentBranch).toBe("main");

    await recoverOrphanedTasks();
    expect((await getTask(c.task.id))!.status).toBe("doing");

    const team = (await fetch(`${server.url}/api/tasks/${c.task.id}/team`).then((x) => x.json())) as {
      runs: unknown[];
      artifacts: Array<{ kind: string }>;
    };
    expect(team.runs).toHaveLength(1);
    expect(team.artifacts.map((a) => a.kind)).toEqual(["brief", "spec"]);

    const edited = "## Şartname\n\n### Kabul kriterleri\n- AC-1: EDITED-SPEC must hold";
    const ok = await post(`/api/tasks/${c.task.id}/team/approve`, { specBody: edited });
    expect(ok.status).toBe(200);
    expect(ok.body.artifact).toMatchObject({ kind: "spec", approved: true, body: edited });

    const done = await waitForStatus(c, "done");
    r = inspect(c);
    expect(done.agent.status).toBe("done");
    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1", "qa:1"]);
    expect(r.calls[2]!.prompt).toContain("EDITED-SPEC");
    expect(r.calls[3]!.prompt).toContain("EDITED-SPEC");
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]!.status).toBe("delivered");
    expect(r.runs[0]!.costUsd).toBeCloseTo(0.04, 6);
    expect(r.currentBranch).toBe("main");
    expect(r.branchFiles(done.branch!)).toEqual(["fake-1.txt"]);

    const again = await post(`/api/tasks/${c.task.id}/team/approve`, {});
    expect(again.status).toBe(409);
  });

  it("abort while awaiting approval returns the task to todo and aborts the run", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { specApproval: true } });
    await runTeamCase(c);
    const res = await post(`/api/tasks/${c.task.id}/abort`);
    expect(res.body).toMatchObject({ aborted: true, source: "awaiting_approval" });
    const task = (await getTask(c.task.id))!;
    expect(task.status).toBe("todo");
    expect(task.agent.status).toBe("error");
    expect(inspect(c).runs[0]).toMatchObject({ status: "aborted" });
  });

  it("passes --model, --tools, isolation flags, skill text and --advisor to each role", async () => {
    const skillBody = "Always use tabs. HOUSE-STYLE-MARKER";
    const c = await makeTeamCase({
      scenario: "pass",
      setupRepo: (repo) => {
        writeRepoFile(repo, ".claude/skills/house-style/SKILL.md", `---\nname: house-style\n---\n${skillBody}\n`);
        git(repo, "add", "-A");
        git(repo, "commit", "-q", "-m", "skill");
      },
    });
    const dev = { ...defaultRole("developer"), model: "opus", advisorModel: "fable", skills: ["project:house-style"] };
    const team = createTeam({ name: "Custom", projectId: c.project.id, roles: [dev, defaultRole("qa")] });
    const { updateTask } = await import("../services/taskService.js");
    c.task = await updateTask(c.task.id, { teamId: team.id });

    const task = await runTeamCase(c);
    const r = inspect(c);
    expect(task.status).toBe("done");
    expect(r.roles).toEqual(["developer:1", "qa:1"]);

    const [d, q] = r.calls;
    expect(d).toMatchObject({ model: "opus", tools: "Read,Write,Edit,Bash,Glob,Grep", strictMcpConfig: true });
    expect(q).toMatchObject({ model: "sonnet", tools: "Read,Bash,Glob,Grep", strictMcpConfig: true });
    for (const call of r.calls) {
      expect(call.settingSources).toBe(ROLE_SETTING_SOURCES.join(","));
      expect(call.argv[0]).toBe("-p");
      expect(call.argv).toContain("bypassPermissions");
    }
    expect(d!.appendSystemPrompt).toContain("Skill: project:house-style");
    expect(d!.appendSystemPrompt).toContain(skillBody);
    expect(d!.appendSystemPrompt).not.toContain("name: house-style");
    expect(q!.appendSystemPrompt).not.toContain(skillBody);
    expect(d!.advisor).toBe(ADVISOR_SUPPORTED ? "fable" : null);
    expect(q!.advisor).toBe(ADVISOR_SUPPORTED ? "opus" : null);
    expect((await getTask(c.task.id))!.agent.log).toContain("⚡ Skills injected: project:house-style");
  });

  it("PR body gets a ## Ekip section with acceptance criteria and the QA result (not for Solo)", () => {
    const run = (teamId: string, qaRound: number): TeamRun => ({
      id: "r",
      taskId: "t",
      teamId,
      teamSnapshot: getTeam(teamId)!,
      status: "delivered",
      qaRound,
      stopReason: null,
      costUsd: 0,
      startedAt: "",
      finishedAt: null,
    });
    const spec = "## Şartname\n\n### Kabul kriterleri\n- AC-1: a\n- AC-2: b\n\n### Test önerisi\n- x";
    const section = buildPrTeamSection({
      kind: "delivered",
      run: run(BUILTIN_TEAM_IDS.yazilimEkibi, 1),
      summary: "",
      spec,
      qaVerdict: "pass",
      qaReport: "",
      allText: "",
    })!;
    expect(section).toContain("## Ekip");
    expect(section).toContain("CEO → Analist → Yazılımcı → QA");
    expect(section).toContain("### Kabul kriterleri\n- AC-1: a\n- AC-2: b");
    expect(section).toContain("PASS · QA turu 2");
    expect(
      buildPrTeamSection({
        kind: "delivered",
        run: run(BUILTIN_TEAM_IDS.solo, 0),
        summary: "",
        spec: null,
        qaVerdict: null,
        qaReport: null,
        allText: "",
      }),
    ).toBeNull();
  });
});
