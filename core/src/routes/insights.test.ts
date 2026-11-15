import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CLAUFLOW_DATA_DIR = `${process.env.TMPDIR ?? "/tmp"}/clauflow-insights-${process.pid}-${Date.now()}`;
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import insightsRouter from "./insights.js";
import {
  addProjectPlanningCost,
  addTaskCost,
  createProject,
  createTask,
  db,
  insertNodeRun,
  updateNodeRun,
} from "../services/taskService.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";

let server: TestServer;
let repo = "";
let projectId = "";

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "clauflow-insights-repo-"));
  const project = await createProject({ name: "Ins", repoPath: repo, defaultBranch: "main", slug: "ins" });
  projectId = project.id;
  const a = await createTask({ projectId, title: "a" });
  const b = await createTask({ projectId, title: "b" });
  addTaskCost(a.id, 0.3767331);
  addTaskCost(b.id, 0.1486596);
  addProjectPlanningCost(projectId, 0.02);

  insertNodeRun({ id: "nr_known", taskId: a.id, nodeId: "role:ceo:1", nodeType: "ceo", model: "sonnet" });
  updateNodeRun("nr_known", { status: "done", inputTokens: 999_999, costUsd: 0.05 });
  // Legacy row: no CLI cost, priced from tokens with its own model.
  insertNodeRun({ id: "nr_legacy", taskId: b.id, nodeId: "role:ceo:1", nodeType: "ceo", model: "sonnet" });
  db.prepare(`UPDATE task_node_runs SET status = 'done', inputTokens = 1000000, costUsd = NULL WHERE id = 'nr_legacy'`).run();
  insertNodeRun({ id: "nr_qa", taskId: b.id, nodeId: "role:qa:1", nodeType: "qa", model: "sonnet" });
  updateNodeRun("nr_qa", { status: "done", costUsd: 0.07 });

  server = await startTestServer([["/api/insights", insightsRouter]]);
});

afterAll(async () => {
  await server.close();
  rmSync(repo, { recursive: true, force: true });
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});

describe("GET /api/insights (A2d, D6c)", () => {
  it("sums real costs: tasks + planner, per node type, recent tasks with displayId", async () => {
    const res = await fetch(`${server.url}/api/insights?projectId=${projectId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: Record<string, unknown>;
      byNodeType: Array<{ nodeType: string; costUsd: number; estimated: boolean; runCount: number }>;
      recentTasks: Array<{ displayId: string | null; costUsd: number; title: string }>;
    };

    expect(body.summary.tasksCostUsd).toBeCloseTo(0.5253927, 9);
    expect(body.summary.planningCostUsd).toBeCloseTo(0.02, 9);
    expect(body.summary.costUsd).toBeCloseTo(0.5453927, 9);
    expect(body.summary).not.toHaveProperty("pricingStale");
    expect(body.summary).not.toHaveProperty("estimatedUsd");

    const ceo = body.byNodeType.find((n) => n.nodeType === "ceo")!;
    expect(ceo.runCount).toBe(2);
    // 0.05 reported + 1M sonnet input tokens priced at $3 for the legacy row.
    expect(ceo.costUsd).toBeCloseTo(3.05, 6);
    expect(ceo.estimated).toBe(true);
    const qa = body.byNodeType.find((n) => n.nodeType === "qa")!;
    expect(qa).toMatchObject({ estimated: false });
    expect(qa.costUsd).toBeCloseTo(0.07, 9);

    const byTitle = Object.fromEntries(body.recentTasks.map((t) => [t.title, t]));
    expect(byTitle.a!.displayId).toBe("INS-1");
    expect(byTitle.a!.costUsd).toBeCloseTo(0.3767331, 9);
    expect(byTitle.b!.costUsd).toBeCloseTo(0.1486596, 9);
  });
});
