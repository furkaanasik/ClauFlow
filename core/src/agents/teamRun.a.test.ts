import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-teamrun-a-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-teamrun-a-gh-${stamp}`;
});

import { rmSync } from "node:fs";
import { listNodeRunsByTask } from "../services/taskService.js";
import { BUILTIN_TEAM_IDS } from "../services/teamTemplates.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase } from "../test-utils/teamHarness.js";
import { buildSoloPrompt } from "./teamPrompts.js";

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("team run A: Solo and Yazılım Ekibi", () => {
  it("Solo runs one developer with today's prompt, commits and returns to main", async () => {
    const c = await makeTeamCase({ project: { defaultTeamId: null } });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(task.status).toBe("done");
    expect(task.agent.status).toBe("done");
    expect(r.roles).toEqual(["developer:1"]);
    expect(r.calls[0]!.prompt).toBe(buildSoloPrompt({ task: c.task, project: c.project }));
    expect(r.calls[0]!.model).toBe("sonnet");

    expect(r.currentBranch).toBe("main");
    expect(r.status).toBe("");
    expect(r.branches).toEqual([task.branch]);
    expect(r.branchLog(task.branch!)).toEqual([`feat(${task.displayId}): Add slugify`]);
    expect(r.branchFiles(task.branch!)).toEqual(["fake-1.txt"]);

    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ teamId: BUILTIN_TEAM_IDS.solo, status: "delivered", qaRound: 0 });
    expect(r.artifacts.map((a) => a.kind)).toEqual(["delivery", "summary"]);
    expect(r.artifacts[0]!.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(r.comments.map((x) => x.body.split("\n")[0])).toEqual(["## Ekip özeti"]);
    expect(listNodeRunsByTask(c.task.id).map((n) => [n.nodeId, n.nodeType, n.status])).toEqual([
      ["role:developer:1", "developer", "done"],
    ]);
  });

  it("Yazılım Ekibi pass: CEO → Analist → Yazılımcı → QA, one commit, QA PASS", async () => {
    const c = await makeTeamCase({ scenario: "pass" });
    expect(c.project.defaultTeamId).toBe(BUILTIN_TEAM_IDS.yazilimEkibi);
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(task.status).toBe("done");
    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1", "qa:1"]);
    expect(r.calls.map((x) => x.model)).toEqual(["sonnet", "opus", "sonnet", "sonnet"]);
    expect(r.calls.map((x) => x.advisor)).toEqual([null, null, "opus", "opus"]);
    expect(r.calls[1]!.prompt).toContain("<ceo_brief>\n## Brief");
    expect(r.calls[2]!.prompt).toContain("<specification>\n## Şartname");
    expect(r.calls[3]!.prompt).toContain("fake-1.txt");

    expect(r.artifacts.map((a) => `${a.kind}:${a.round}`)).toEqual([
      "brief:1",
      "spec:1",
      "delivery:1",
      "qa_report:1",
      "summary:0",
    ]);
    expect(r.artifacts[3]!.verdict).toBe("pass");
    expect(r.runs[0]).toMatchObject({ status: "delivered", qaRound: 0 });
    expect(r.runs[0]!.costUsd).toBeCloseTo(0.04, 6);
    expect(r.branchLog(task.branch!)).toHaveLength(1);
    expect(r.currentBranch).toBe("main");
    const summary = r.comments.find((x) => x.body.startsWith("## Ekip özeti"))!;
    expect(summary.body).toContain("QA: PASS (tur 1)");
    expect(summary.body).toContain("VERDICT: PASS");
  });

  it("fail_then_pass: two developer commits and QA round 2 sees the real diff", async () => {
    const c = await makeTeamCase({ scenario: "fail_then_pass" });
    const task = await runTeamCase(c);
    const r = inspect(c);

    expect(task.status).toBe("done");
    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1", "qa:1", "developer:2", "qa:2"]);
    expect(r.branchLog(task.branch!)).toEqual([
      `fix(${task.displayId}): QA turu 2`,
      `feat(${task.displayId}): Add slugify`,
    ]);
    expect(r.branchFiles(task.branch!).sort()).toEqual(["fake-1.txt", "fake-2.txt"]);

    const qa1 = r.calls[3]!.prompt;
    const dev2 = r.calls[4]!.prompt;
    const qa2 = r.calls[5]!.prompt;
    expect(qa1).toContain("fake-1.txt");
    expect(qa1).not.toContain("fake-2.txt");
    expect(qa2).toContain("+fake developer output round 2");
    expect(qa2).toContain("fake-1.txt");
    expect(dev2).toContain("<qa_bug_list>");
    expect(dev2).toContain("AC-1 is not met");
    expect(dev2).toContain("<previous_delivery_note>");

    const qa = r.artifacts.filter((a) => a.kind === "qa_report");
    expect(qa.map((a) => a.verdict)).toEqual(["fail", "pass"]);
    const dev = r.artifacts.filter((a) => a.kind === "delivery");
    expect(dev.map((a) => a.round)).toEqual([1, 2]);
    expect(new Set(dev.map((a) => a.commitSha)).size).toBe(2);
    expect(r.runs[0]).toMatchObject({ status: "delivered", qaRound: 1 });
  });
});
