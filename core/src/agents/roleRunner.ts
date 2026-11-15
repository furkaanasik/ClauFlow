import { randomUUID } from "node:crypto";
import {
  parseUsageFromResult,
  runClaude,
  type ClaudeRunOptions,
  type ClaudeUsage,
} from "../services/claudeService.js";
import { calculateCostUsd } from "../services/pricingService.js";
import {
  appendAgentLog,
  insertAgentText,
  insertNodeRun,
  insertToolCall,
  updateNodeRun,
  updateTaskUsage,
  updateToolCall,
} from "../services/taskService.js";
import {
  broadcastAgentText,
  broadcastBudgetExceeded,
  broadcastLog,
  broadcastNodeFinished,
  broadcastNodeStarted,
  broadcastTaskUpdated,
  broadcastToolCall,
} from "../services/wsService.js";
import type { NodeType } from "../types/index.js";

/** Role calls skip user-level settings (hooks, plugins) and the user's MCP servers. */
export const ROLE_SETTING_SOURCES = ["project", "local"];

export interface RunRoleOptions {
  taskId: string;
  cwd: string;
  /** Parent controller: aborting it (user abort) kills the role. */
  signal: AbortSignal;
  nodeId: string;
  nodeType: NodeType;
  prompt: string;
  appendSystemPrompt?: string;
  model: string | null;
  advisorModel?: string | null;
  tools: string[];
  /** Isolate from user settings/hooks and MCP servers (team role calls). */
  isolate?: boolean;
  /** Effective task budget; null = unlimited. */
  budgetUsd: number | null;
  /** Cost already spent by earlier roles of the same run. */
  spentBeforeUsd: number;
  /** Names for the `budget_exceeded` toast (A8d). */
  budgetContext?: { taskTitle: string; displayId: string | null; projectId: string; projectName: string };
  inputArtifact?: Record<string, unknown> | null;
}

export interface RoleRunResult {
  nodeRunId: string;
  /** `result` field of the final stream-json event, else the concatenated agent text. */
  finalText: string;
  /** Every agent text chunk of this role, concatenated. */
  text: string;
  costUsd: number;
  usage: ClaudeUsage;
  budgetExceeded: boolean;
}

export class RoleRunError extends Error {
  constructor(
    message: string,
    readonly aborted: boolean,
  ) {
    super(message);
    this.name = "RoleRunError";
  }
}

const EMPTY_USAGE: ClaudeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Cost of a finished CLI call. `total_cost_usd` includes advisor spend, so it
 * wins; `modelUsage[*].costUSD` is the next best; token pricing is the fallback.
 */
export function costFromResult(raw: unknown, model: string | null): number | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const total = num(r.total_cost_usd);
  if (total !== null) return total;
  if (r.modelUsage && typeof r.modelUsage === "object") {
    let sum = 0;
    let found = false;
    for (const entry of Object.values(r.modelUsage as Record<string, unknown>)) {
      const c = entry && typeof entry === "object" ? num((entry as Record<string, unknown>).costUSD) : null;
      if (c !== null) {
        sum += c;
        found = true;
      }
    }
    if (found) return sum;
  }
  const usage = parseUsageFromResult(raw);
  return usage ? calculateCostUsd(usage, model) : null;
}

export async function runRole(opts: RunRoleOptions): Promise<RoleRunResult> {
  const { taskId, nodeId } = opts;
  const roleController = new AbortController();
  const onParentAbort = () => roleController.abort();
  if (opts.signal.aborted) roleController.abort();
  else opts.signal.addEventListener("abort", onParentAbort, { once: true });

  const nodeRunId = `noderun_${randomUUID().slice(0, 8)}`;
  try {
    const nr = insertNodeRun({
      id: nodeRunId,
      taskId,
      nodeId,
      nodeType: opts.nodeType,
      status: "running",
      startedAt: new Date().toISOString(),
      model: opts.model,
      inputArtifact: opts.inputArtifact ?? null,
    });
    broadcastNodeStarted(nr);
  } catch (e) {
    console.error(`[roleRunner] insertNodeRun(${nodeId}) failed:`, e);
  }

  const logBuffer: string[] = [];
  const onLogLine = async (line: string, stream: "stdout" | "stderr"): Promise<void> => {
    const entry = stream === "stderr" ? `[stderr] ${line}` : line;
    await appendAgentLog(taskId, entry);
    broadcastLog(taskId, entry);
    logBuffer.push(entry);
    if (logBuffer.length > 200) logBuffer.splice(0, logBuffer.length - 200);
  };

  const subagentRunIds = new Set<string>();

  const onToolCallStart = (tc: { id: string; toolName: string; args: unknown; startedAt: string }): void => {
    try {
      const stored = insertToolCall({
        id: tc.id,
        taskId,
        toolName: tc.toolName,
        args: tc.args,
        status: "running",
        startedAt: tc.startedAt,
      });
      broadcastToolCall(stored);
    } catch (e) {
      console.error(`[roleRunner] insertToolCall failed for ${tc.id}:`, e);
    }
    if (tc.toolName === "Agent") {
      const args = tc.args as Record<string, unknown> | null;
      subagentRunIds.add(tc.id);
      const subagentType = typeof args?.subagent_type === "string" ? args.subagent_type : "subagent";
      const description = typeof args?.description === "string" ? args.description : "";
      try {
        const nr = insertNodeRun({
          id: tc.id,
          taskId,
          nodeId: tc.id,
          nodeType: "subagent",
          status: "running",
          startedAt: tc.startedAt,
          inputArtifact: { description: description || null, subagent_type: subagentType },
        });
        broadcastNodeStarted(nr);
      } catch (e) {
        console.error(`[roleRunner] insertNodeRun(subagent) failed for ${tc.id}:`, e);
      }
    }
  };

  const onToolCallEnd = (tc: {
    id: string;
    result: string | null;
    status: "running" | "done" | "error";
    finishedAt: string | null;
    durationMs: number | null;
  }): void => {
    try {
      const updated = updateToolCall(tc.id, {
        status: tc.status,
        result: tc.result,
        finishedAt: tc.finishedAt,
        durationMs: tc.durationMs,
      });
      if (updated) broadcastToolCall(updated);
    } catch (e) {
      console.error(`[roleRunner] updateToolCall failed for ${tc.id}:`, e);
    }
    if (subagentRunIds.has(tc.id)) {
      subagentRunIds.delete(tc.id);
      try {
        const logLines = tc.result ? tc.result.split(/\r?\n/).filter((l) => l.trim().length > 0) : [];
        const finished = updateNodeRun(tc.id, {
          status: tc.status === "error" ? "error" : "done",
          finishedAt: tc.finishedAt ?? new Date().toISOString(),
          errorMessage: tc.status === "error" ? (tc.result?.slice(0, 300) ?? null) : null,
          outputArtifact: logLines.length > 0 ? { logLines } : null,
        });
        if (finished) broadcastNodeFinished(finished);
      } catch (e) {
        console.error(`[roleRunner] updateNodeRun(subagent) failed for ${tc.id}:`, e);
      }
    }
  };

  let text = "";
  const onAgentText = (chunk: string): void => {
    if (!chunk || !chunk.trim()) return;
    text += (text ? "\n" : "") + chunk;
    try {
      const stored = insertAgentText({ taskId, text: chunk });
      broadcastAgentText(stored);
    } catch (e) {
      console.error(`[roleRunner] insertAgentText failed:`, e);
    }
  };

  let budgetExceeded = false;
  const exceedBudget = (spentUsd: number): void => {
    if (budgetExceeded || opts.budgetUsd == null) return;
    budgetExceeded = true;
    broadcastBudgetExceeded(taskId, {
      spentUsd,
      budgetUsd: opts.budgetUsd,
      taskTitle: opts.budgetContext?.taskTitle ?? "",
      displayId: opts.budgetContext?.displayId ?? null,
      projectId: opts.budgetContext?.projectId ?? "",
      projectName: opts.budgetContext?.projectName ?? "",
    });
    roleController.abort();
  };

  let midRunCost = 0;
  let usageTurnFired = false;
  let usage: ClaudeUsage = { ...EMPTY_USAGE };
  let resultCost: number | null = null;
  let resultText: string | null = null;

  const onUsageTurn = (turn: ClaudeUsage): void => {
    usageTurnFired = true;
    usage = {
      inputTokens: usage.inputTokens + turn.inputTokens,
      outputTokens: usage.outputTokens + turn.outputTokens,
      cacheReadTokens: usage.cacheReadTokens + turn.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens + turn.cacheWriteTokens,
    };
    midRunCost += calculateCostUsd(turn, opts.model);
    updateTaskUsage(taskId, turn)
      .then((t) => {
        if (t) broadcastTaskUpdated(t);
      })
      .catch((e) => console.error(`[roleRunner] mid-run updateTaskUsage failed:`, e));
    const spent = opts.spentBeforeUsd + midRunCost;
    if (opts.budgetUsd != null && spent >= opts.budgetUsd) exceedBudget(spent);
  };

  const onClaudeResult = (raw: unknown): void => {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (typeof r.result === "string") resultText = r.result;
    resultCost = costFromResult(raw, opts.model);
    const final = parseUsageFromResult(raw);
    if (final) usage = final;
    const spent = opts.spentBeforeUsd + (resultCost ?? midRunCost);
    if (opts.budgetUsd != null && spent >= opts.budgetUsd) exceedBudget(spent);
    // Only write to DB if onUsageTurn never fired — avoids double-count.
    if (usageTurnFired || !final) return;
    updateTaskUsage(taskId, final)
      .then((t) => {
        if (t) broadcastTaskUpdated(t);
      })
      .catch((e) => console.error(`[roleRunner] updateTaskUsage failed:`, e));
  };

  const base: ClaudeRunOptions = {
    prompt: opts.prompt,
    cwd: opts.cwd,
    model: opts.model ?? undefined,
    tools: opts.tools,
    appendSystemPrompt: opts.appendSystemPrompt,
    advisorModel: opts.advisorModel ?? null,
    ...(opts.isolate ? { strictMcpConfig: true, settingSources: ROLE_SETTING_SOURCES } : {}),
    signal: roleController.signal,
    onLine: onLogLine,
  };

  const finalize = (patch: Parameters<typeof updateNodeRun>[1]): void => {
    try {
      const updated = updateNodeRun(nodeRunId, {
        finishedAt: new Date().toISOString(),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        ...patch,
      });
      if (updated) broadcastNodeFinished(updated);
    } catch (e) {
      console.error(`[roleRunner] updateNodeRun(${nodeId}) failed:`, e);
    }
  };

  try {
    let claudeResult = await runClaude({
      ...base,
      outputFormat: "stream-json",
      onText: onAgentText,
      onToolCallStart,
      onToolCallEnd,
      onUsage: onUsageTurn,
      onResult: onClaudeResult,
    });

    // Fallback safety: if stream-json mode fails (e.g. CLI version mismatch),
    // retry once with plain text output so the run still completes.
    if (claudeResult.code !== 0 && !roleController.signal.aborted) {
      const errSnippet = (claudeResult.stderr || claudeResult.stdout).slice(0, 200);
      if (/unknown.*output[- ]format|stream-json|--verbose/i.test(errSnippet)) {
        await onLogLine("[fallback] stream-json mode failed; retrying with text output", "stdout");
        claudeResult = await runClaude({ ...base, onText: onAgentText });
        if (claudeResult.code === 0 && !text.trim()) text = claudeResult.stdout.trim();
      }
    }

    const costUsd = resultCost ?? midRunCost;
    const artifactLog = logBuffer.length > 0 ? { logLines: [...logBuffer] } : {};

    if (opts.signal.aborted) {
      finalize({ status: "aborted", errorMessage: "Aborted by user", outputArtifact: artifactLog });
      throw new RoleRunError("aborted", true);
    }
    if (!budgetExceeded && claudeResult.code !== 0) {
      const msg = `claude CLI exited ${claudeResult.code}:\n${claudeResult.stderr.slice(0, 500)}`;
      finalize({ status: "error", errorMessage: `exit ${claudeResult.code}`, outputArtifact: artifactLog });
      throw new RoleRunError(msg, false);
    }

    const finalText = (resultText ?? "").trim() || text.trim();
    finalize({
      status: budgetExceeded && claudeResult.code !== 0 ? "aborted" : "done",
      errorMessage: budgetExceeded ? "budget_exceeded" : null,
      outputArtifact: { text: finalText, costUsd, ...artifactLog },
    });
    return { nodeRunId, finalText, text, costUsd, usage, budgetExceeded };
  } catch (err) {
    if (err instanceof RoleRunError) throw err;
    finalize({ status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    opts.signal.removeEventListener("abort", onParentAbort);
  }
}
