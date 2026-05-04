import { Router, type Request, type Response } from "express";
import { db } from "../services/taskService.js";
import { calculateCostUsd, DEFAULT_MODEL } from "../services/pricingService.js";
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
}

interface RecentRow {
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

function aggregateByNodeType(rows: NodeAggRow[]) {
  const map = new Map<
    string,
    {
      nodeType: string;
      runCount: number;
      doneCount: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      estimatedUsd: number;
    }
  >();
  for (const r of rows) {
    const usd = calculateCostUsd(
      {
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
      },
      r.model,
    );
    const existing = map.get(r.nodeType);
    if (existing) {
      existing.runCount += r.runCount;
      existing.doneCount += r.doneCount;
      existing.inputTokens += r.inputTokens;
      existing.outputTokens += r.outputTokens;
      existing.cacheReadTokens += r.cacheReadTokens;
      existing.cacheWriteTokens += r.cacheWriteTokens;
      existing.estimatedUsd += usd;
    } else {
      map.set(r.nodeType, {
        nodeType: r.nodeType,
        runCount: r.runCount,
        doneCount: r.doneCount,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        estimatedUsd: usd,
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
          ELSE NULL END) as avgTimeToGreenMs
      FROM tasks WHERE projectId = ?
    `,
      )
      .get(projectId) as SummaryRow;

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
        SUM(COALESCE(nr.cacheWriteTokens, 0)) as cacheWriteTokens
      FROM task_node_runs nr
      JOIN tasks t ON t.id = nr.taskId
      WHERE t.projectId = ?
      GROUP BY nr.nodeType, nr.model
    `,
      )
      .all(projectId) as NodeAggRow[];

    const ciRow = db
      .prepare(
        `
      SELECT
        SUM(CASE WHEN nr.nodeType = 'ci' AND nr.status = 'done' THEN 1 ELSE 0 END) as ciDone,
        SUM(CASE WHEN nr.nodeType = 'ci' THEN 1 ELSE 0 END) as ciTotal
      FROM task_node_runs nr
      JOIN tasks t ON t.id = nr.taskId
      WHERE t.projectId = ?
    `,
      )
      .get(projectId) as { ciDone: number; ciTotal: number };

    const recentRows = db
      .prepare(
        `
      SELECT
        t.id, t.title, t.status, t.agentStatus, t.createdAt,
        COALESCE(t.inputTokens, 0) as inputTokens,
        COALESCE(t.outputTokens, 0) as outputTokens,
        COALESCE(t.cacheReadTokens, 0) as cacheReadTokens,
        COALESCE(t.cacheWriteTokens, 0) as cacheWriteTokens,
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

    const summaryUsd = calculateCostUsd(
      {
        inputTokens: summaryRow.totalInputTokens,
        outputTokens: summaryRow.totalOutputTokens,
        cacheReadTokens: summaryRow.totalCacheReadTokens,
        cacheWriteTokens: summaryRow.totalCacheWriteTokens,
      },
      DEFAULT_MODEL,
    );

    const byNodeType = aggregateByNodeType(nodeRows);

    const recentTasks = recentRows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      agentStatus: r.agentStatus,
      createdAt: r.createdAt,
      estimatedUsd: calculateCostUsd(
        {
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cacheReadTokens: r.cacheReadTokens,
          cacheWriteTokens: r.cacheWriteTokens,
        },
        DEFAULT_MODEL,
      ),
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
        estimatedUsd: summaryUsd,
        avgTimeToGreenMs: summaryRow.avgTimeToGreenMs ?? null,
        ciPassRate:
          ciRow.ciTotal > 0 ? ciRow.ciDone / ciRow.ciTotal : null,
      },
      byNodeType,
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
      const header =
        "id,title,status,agentStatus,createdAt,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,agentStartedAt,agentFinishedAt,prNumber\n";
      const lines = rows
        .map((r) =>
          [
            r.id,
            `"${r.title.replace(/"/g, '""')}"`,
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
