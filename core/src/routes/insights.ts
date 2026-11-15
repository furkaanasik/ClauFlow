import { Router, type Request, type Response } from "express";
import { db } from "../services/taskService.js";
import { calculateCostUsd } from "../services/pricingService.js";
import { errorMessage } from "../utils/error.js";

interface SummaryRow {
  totalTasks: number;
  doneTasks: number;
  errorTasks: number;
  prCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  avgTimeToGreenMs: number | null;
  tasksCostUsd: number | null;
}

interface NodeAggRow {
  nodeType: string;
  model: string | null;
  runCount: number;
  doneCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  knownUsd: number;
  legacyInputTokens: number;
  legacyOutputTokens: number;
  legacyCacheReadTokens: number;
  legacyCacheWriteTokens: number;
}

interface RecentRow {
  id: string;
  displayId: string | null;
  title: string;
  status: string;
  agentStatus: string;
  createdAt: string;
  costUsd: number;
  agentStartedAt: string | null;
  agentFinishedAt: string | null;
  nodeRunCount: number;
}

interface ExportRow {
  id: string;
  title: string;
  status: string;
  agentStatus: string;
  createdAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  agentStartedAt: string | null;
  agentFinishedAt: string | null;
  prNumber: number | null;
}

export interface NodeTypeCost {
  nodeType: string;
  runCount: number;
  doneCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** CLI-reported `task_node_runs.costUsd`, plus a token-priced estimate for legacy rows without one. */
  costUsd: number;
  /** True when part of `costUsd` is a token estimate (rows written before F3). */
  estimated: boolean;
}

/**
 * Cost per node type. Rows with a CLI-reported `costUsd` are summed as-is;
 * older rows (NULL) fall back to token pricing with their own model and the
 * group is flagged `estimated`.
 */
function aggregateByNodeType(rows: NodeAggRow[]): NodeTypeCost[] {
  const map = new Map<string, NodeTypeCost>();
  for (const r of rows) {
    const legacy = {
      inputTokens: r.legacyInputTokens,
      outputTokens: r.legacyOutputTokens,
      cacheReadTokens: r.legacyCacheReadTokens,
      cacheWriteTokens: r.legacyCacheWriteTokens,
    };
    const hasLegacy = Object.values(legacy).some((v) => v > 0);
    const usd = r.knownUsd + (hasLegacy ? calculateCostUsd(legacy, r.model) : 0);
    const existing = map.get(r.nodeType);
    if (existing) {
      existing.runCount += r.runCount;
      existing.doneCount += r.doneCount;
      existing.inputTokens += r.inputTokens;
      existing.outputTokens += r.outputTokens;
      existing.cacheReadTokens += r.cacheReadTokens;
      existing.cacheWriteTokens += r.cacheWriteTokens;
      existing.costUsd += usd;
      existing.estimated ||= hasLegacy;
    } else {
      map.set(r.nodeType, {
        nodeType: r.nodeType,
        runCount: r.runCount,
        doneCount: r.doneCount,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        costUsd: usd,
        estimated: hasLegacy,
      });
    }
  }
  return Array.from(map.values());
}

const router = Router();

router.get("/", (req: Request, res: Response) => {
  try {
    const projectId = String(req.query.projectId ?? "");
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }

    const summaryRow = db
      .prepare(
        `
      SELECT
        COUNT(*) as totalTasks,
        SUM(CASE WHEN status IN ('done','review') THEN 1 ELSE 0 END) as doneTasks,
        SUM(CASE WHEN agentStatus = 'error' THEN 1 ELSE 0 END) as errorTasks,
        SUM(CASE WHEN prNumber IS NOT NULL THEN 1 ELSE 0 END) as prCount,
        SUM(COALESCE(inputTokens, 0)) as totalInputTokens,
        SUM(COALESCE(outputTokens, 0)) as totalOutputTokens,
        SUM(COALESCE(cacheReadTokens, 0)) as totalCacheReadTokens,
        SUM(COALESCE(cacheWriteTokens, 0)) as totalCacheWriteTokens,
        AVG(CASE
          WHEN agentStartedAt IS NOT NULL AND agentFinishedAt IS NOT NULL
          THEN (julianday(agentFinishedAt) - julianday(agentStartedAt)) * 86400000.0
          ELSE NULL END) as avgTimeToGreenMs,
        SUM(COALESCE(costUsd, 0)) as tasksCostUsd
      FROM tasks WHERE projectId = ?
    `,
      )
      .get(projectId) as SummaryRow;

    const planningRow = db
      .prepare(`SELECT COALESCE(planningCostUsd, 0) as planningCostUsd FROM projects WHERE id = ?`)
      .get(projectId) as { planningCostUsd: number } | undefined;

    const nodeRows = db
      .prepare(
        `
      SELECT
        nr.nodeType,
        nr.model,
        COUNT(*) as runCount,
        SUM(CASE WHEN nr.status = 'done' THEN 1 ELSE 0 END) as doneCount,
        SUM(COALESCE(nr.inputTokens, 0)) as inputTokens,
        SUM(COALESCE(nr.outputTokens, 0)) as outputTokens,
        SUM(COALESCE(nr.cacheReadTokens, 0)) as cacheReadTokens,
        SUM(COALESCE(nr.cacheWriteTokens, 0)) as cacheWriteTokens,
        SUM(COALESCE(nr.costUsd, 0)) as knownUsd,
        SUM(CASE WHEN nr.costUsd IS NULL THEN COALESCE(nr.inputTokens, 0) ELSE 0 END) as legacyInputTokens,
        SUM(CASE WHEN nr.costUsd IS NULL THEN COALESCE(nr.outputTokens, 0) ELSE 0 END) as legacyOutputTokens,
        SUM(CASE WHEN nr.costUsd IS NULL THEN COALESCE(nr.cacheReadTokens, 0) ELSE 0 END) as legacyCacheReadTokens,
        SUM(CASE WHEN nr.costUsd IS NULL THEN COALESCE(nr.cacheWriteTokens, 0) ELSE 0 END) as legacyCacheWriteTokens
      FROM task_node_runs nr
      JOIN tasks t ON t.id = nr.taskId
      WHERE t.projectId = ?
      GROUP BY nr.nodeType, nr.model
    `,
      )
      .all(projectId) as NodeAggRow[];

    const recentRows = db
      .prepare(
        `
      SELECT
        t.id, t.displayId, t.title, t.status, t.agentStatus, t.createdAt,
        COALESCE(t.costUsd, 0) as costUsd,
        t.agentStartedAt, t.agentFinishedAt,
        COUNT(nr.id) as nodeRunCount
      FROM tasks t
      LEFT JOIN task_node_runs nr ON nr.taskId = t.id
      WHERE t.projectId = ?
      GROUP BY t.id
      ORDER BY t.createdAt DESC
      LIMIT 20
    `,
      )
      .all(projectId) as RecentRow[];

    const tasksCostUsd = summaryRow.tasksCostUsd ?? 0;
    const planningCostUsd = planningRow?.planningCostUsd ?? 0;

    const recentTasks = recentRows.map((r) => ({
      id: r.id,
      displayId: r.displayId,
      title: r.title,
      status: r.status,
      agentStatus: r.agentStatus,
      createdAt: r.createdAt,
      costUsd: r.costUsd,
      timeToGreenMs:
        r.agentStartedAt && r.agentFinishedAt
          ? new Date(r.agentFinishedAt).getTime() -
            new Date(r.agentStartedAt).getTime()
          : null,
      nodeRunCount: r.nodeRunCount,
    }));

    res.json({
      projectId,
      summary: {
        totalTasks: summaryRow.totalTasks,
        doneTasks: summaryRow.doneTasks,
        errorTasks: summaryRow.errorTasks,
        prCount: summaryRow.prCount,
        totalInputTokens: summaryRow.totalInputTokens,
        totalOutputTokens: summaryRow.totalOutputTokens,
        totalCacheReadTokens: summaryRow.totalCacheReadTokens,
        totalCacheWriteTokens: summaryRow.totalCacheWriteTokens,
        costUsd: tasksCostUsd + planningCostUsd,
        tasksCostUsd,
        planningCostUsd,
        avgTimeToGreenMs: summaryRow.avgTimeToGreenMs ?? null,
      },
      byNodeType: aggregateByNodeType(nodeRows),
      recentTasks,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/export", (req: Request, res: Response) => {
  try {
    const projectId = String(req.query.projectId ?? "");
    const format = String(req.query.format ?? "json");
    if (!projectId) {
      res.status(400).json({ error: "projectId required" });
      return;
    }

    const rows = db
      .prepare(
        `
      SELECT t.id, t.title, t.status, t.agentStatus, t.createdAt,
        COALESCE(t.inputTokens, 0) as inputTokens,
        COALESCE(t.outputTokens, 0) as outputTokens,
        COALESCE(t.cacheReadTokens, 0) as cacheReadTokens,
        COALESCE(t.cacheWriteTokens, 0) as cacheWriteTokens,
        t.agentStartedAt, t.agentFinishedAt, t.prNumber
      FROM tasks t WHERE t.projectId = ? ORDER BY t.createdAt DESC
    `,
      )
      .all(projectId) as ExportRow[];

    if (format === "csv") {
      const safeCsvStr = (v: string) =>
        `"${v.replace(/^[=+\-@|%]/, "'$&").replace(/"/g, '""')}"`;
      const header =
        "id,title,status,agentStatus,createdAt,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,agentStartedAt,agentFinishedAt,prNumber\n";
      const lines = rows
        .map((r) =>
          [
            r.id,
            safeCsvStr(r.title),
            r.status,
            r.agentStatus,
            r.createdAt,
            r.inputTokens,
            r.outputTokens,
            r.cacheReadTokens,
            r.cacheWriteTokens,
            r.agentStartedAt ?? "",
            r.agentFinishedAt ?? "",
            r.prNumber ?? "",
          ].join(","),
        )
        .join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="insights-${projectId}.csv"`,
      );
      res.send(header + lines);
    } else {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="insights-${projectId}.json"`,
      );
      res.json(rows);
    }
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
