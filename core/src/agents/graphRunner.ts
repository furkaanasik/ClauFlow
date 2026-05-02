import { randomUUID } from "node:crypto";
import { run as gitRun } from "../services/gitService.js";
import { parseUsageFromResult, runClaude } from "../services/claudeService.js";
import {
  loadAgentDefinition,
  type AgentDefinition,
} from "../services/graphService.js";
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
  broadcastLog,
  broadcastNodeFinished,
  broadcastNodeStarted,
  broadcastTaskUpdated,
  broadcastToolCall,
} from "../services/wsService.js";
import type {
  AgentGraph,
  NodeRun,
  NodeType,
  Project,
  Task,
} from "../types/index.js";

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
const DIFF_TRUNCATE = 30_000;
const KNOWN_NODE_TYPES: NodeType[] = [
  "planner",
  "coder",
  "reviewer",
  "tester",
];

export interface NodeArtifact {
  /** Concatenated agent_text events from the prior node. */
  text: string;
  /** Captured after a coder node via `git diff <base>..HEAD`. Null otherwise. */
  diff: string | null;
  /** Free-form extras a node may attach. */
  extra: Record<string, unknown>;
}

export interface GraphPlan {
  /** Linear node order; ids match graph.nodes[].id. */
  order: string[];
  /** slug for each node id, resolved at plan time. */
  slugById: Record<string, string>;
}

export type GraphValidationReason =
  | "no_nodes"
  | "no_entry"
  | "multiple_entries"
  | "cycle"
  | "branching"
  | "disconnected";

export class GraphValidationError extends Error {
  constructor(public reason: GraphValidationReason) {
    super(`Graph validation failed: ${reason}`);
    this.name = "GraphValidationError";
  }
}

export function planGraph(graph: AgentGraph): GraphPlan {
  if (graph.nodes.length === 0) throw new GraphValidationError("no_nodes");

  const incoming = new Map<string, number>();
  for (const n of graph.nodes) incoming.set(n.id, 0);
  for (const e of graph.edges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }
  const entries = [...incoming.entries()]
    .filter(([, c]) => c === 0)
    .map(([id]) => id);

  if (graph.edges.length > 0 && entries.length === 0) {
    throw new GraphValidationError("no_entry");
  }
  if (graph.nodes.length > 1 && entries.length > 1) {
    throw new GraphValidationError("multiple_entries");
  }

  const outBySource = new Map<string, string[]>();
  for (const e of graph.edges) {
    const arr = outBySource.get(e.source) ?? [];
    arr.push(e.target);
    outBySource.set(e.source, arr);
  }
  for (const [, targets] of outBySource) {
    if (targets.length > 1) throw new GraphValidationError("branching");
  }

  const order: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = entries[0];
  while (cur) {
    if (seen.has(cur)) throw new GraphValidationError("cycle");
    seen.add(cur);
    order.push(cur);
    cur = outBySource.get(cur)?.[0];
  }
  if (order.length !== graph.nodes.length) {
    throw new GraphValidationError("disconnected");
  }

  const slugById: Record<string, string> = {};
  for (const n of graph.nodes) slugById[n.id] = n.data.slug;
  return { order, slugById };
}

export function deriveNodeType(slug: string): NodeType {
  const lower = slug.toLowerCase();
  for (const t of KNOWN_NODE_TYPES) {
    if (lower === t || lower.startsWith(`${t}-`) || lower.endsWith(`-${t}`)) {
      return t;
    }
  }
  return "custom";
}

export function buildNodePrompt(
  agent: AgentDefinition,
  task: Task,
  project: Project,
  prior: NodeArtifact | null,
): string {
  const taskBrief = task.analysis || task.description || task.title;
  const background = project.aiPrompt?.trim();

  const sections: string[] = [];
  sections.push(agent.body.trim() || `# ${agent.frontmatter.name ?? agent.slug}`);
  sections.push("---");
  if (background) {
    sections.push(`Project background (reference only):\n${background}`);
  }
  sections.push(`Current task:\n${taskBrief}`);

  if (prior) {
    const priorText = prior.text || "(no narrative output)";
    let priorBlock = `Previous node output:\n${priorText}`;
    if (prior.diff) {
      const truncated = prior.diff.slice(0, DIFF_TRUNCATE);
      const wasTruncated = prior.diff.length > DIFF_TRUNCATE;
      priorBlock +=
        `\n\nDiff from prior node` +
        (wasTruncated ? ` (truncated to ${DIFF_TRUNCATE} chars):` : ":") +
        `\n\`\`\`diff\n${truncated}\n\`\`\``;
    }
    sections.push(priorBlock);
  }

  sections.push("When done, exit the terminal.");
  return sections.join("\n\n");
}

export interface RunGraphResult {
  finalArtifact: NodeArtifact;
  completedNodes: number;
}

export async function runGraph(
  task: Task,
  project: Project,
  graph: AgentGraph,
  controller: AbortController,
  baseBranch: string,
): Promise<RunGraphResult> {
  const plan = planGraph(graph);
  let prior: NodeArtifact | null = null;
  let completedNodes = 0;

  for (const nodeId of plan.order) {
    if (controller.signal.aborted) {
      throw new Error("aborted");
    }

    const slug = plan.slugById[nodeId];
    if (!slug) {
      throw new Error(`Graph node '${nodeId}' has no slug mapping`);
    }
    const agent = loadAgentDefinition(project.repoPath, slug);
    if (!agent) {
      throw new Error(
        `Agent file missing for node '${nodeId}' (.claude/agents/${slug}.md)`,
      );
    }

    const nodeType = deriveNodeType(slug);
    const nodeRunId = `noderun_${randomUUID().slice(0, 8)}`;

    let nodeRun: NodeRun;
    try {
      nodeRun = insertNodeRun({
        id: nodeRunId,
        taskId: task.id,
        nodeId,
        nodeType,
        status: "running",
        startedAt: new Date().toISOString(),
        inputArtifact: prior
          ? {
              text: prior.text,
              diff: prior.diff,
              extra: prior.extra,
            }
          : null,
        model: agent.frontmatter.model ?? null,
      });
      broadcastNodeStarted(nodeRun);
    } catch (e) {
      console.error(`[graphRunner] insertNodeRun failed for ${nodeId}:`, e);
      throw e instanceof Error ? e : new Error(String(e));
    }

    await pushLog(task.id, "");
    await pushLog(task.id, `▸ Node: ${nodeId} (${slug})`);

    const prompt = buildNodePrompt(agent, task, project, prior);
    const allowedTools = agent.allowedTools ?? DEFAULT_TOOLS;

    let textBuffer = "";

    const onLogLine = async (
      line: string,
      stream: "stdout" | "stderr",
    ): Promise<void> => {
      const entry = stream === "stderr" ? `[stderr] ${line}` : line;
      await appendAgentLog(task.id, entry);
      broadcastLog(task.id, entry);
    };

    const onAgentText = (text: string): void => {
      if (!text || !text.trim()) return;
      textBuffer += (textBuffer ? "\n" : "") + text;
      try {
        const stored = insertAgentText({ taskId: task.id, text });
        broadcastAgentText(stored);
      } catch (e) {
        console.error(`[graphRunner] insertAgentText failed:`, e);
      }
    };

    const onToolCallStart = (tc: {
      id: string;
      toolName: string;
      args: unknown;
      startedAt: string;
    }): void => {
      try {
        const stored = insertToolCall({
          id: tc.id,
          taskId: task.id,
          toolName: tc.toolName,
          args: tc.args,
          status: "running",
          startedAt: tc.startedAt,
        });
        broadcastToolCall(stored);
      } catch (e) {
        console.error(`[graphRunner] insertToolCall failed:`, e);
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
        console.error(`[graphRunner] updateToolCall failed:`, e);
      }
    };

    let cumulativeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    const onClaudeResult = (raw: unknown): void => {
      const usage = parseUsageFromResult(raw);
      if (!usage) return;
      cumulativeUsage = usage;
      updateTaskUsage(task.id, usage)
        .then((t) => {
          if (t) broadcastTaskUpdated(t);
        })
        .catch((e) => {
          console.error(`[graphRunner] updateTaskUsage failed:`, e);
        });
    };

    let claudeResult;
    try {
      claudeResult = await runClaude({
        prompt,
        cwd: project.repoPath,
        allowedTools,
        signal: controller.signal,
        outputFormat: "stream-json",
        onLine: onLogLine,
        onText: onAgentText,
        onToolCallStart,
        onToolCallEnd,
        onResult: onClaudeResult,
      });
    } catch (err) {
      finalizeNodeRunRow(nodeRunId, "error", errMessage(err));
      throw err;
    }

    if (controller.signal.aborted) {
      finalizeNodeRunRow(nodeRunId, "aborted", "Aborted by user");
      throw new Error("aborted");
    }

    if (claudeResult.code !== 0) {
      const msg = `claude CLI exited ${claudeResult.code}:\n${claudeResult.stderr.slice(0, 500)}`;
      finalizeNodeRunRow(nodeRunId, "error", msg);
      throw new Error(msg);
    }

    let diffOut: string | null = prior?.diff ?? null;
    if (nodeType === "coder") {
      const diff = await gitRun(
        "git",
        ["diff", `${baseBranch}..HEAD`],
        project.repoPath,
      );
      if (diff.code === 0) {
        diffOut = diff.stdout;
      }
    }

    const artifact: NodeArtifact = {
      text: textBuffer,
      diff: diffOut,
      extra: {},
    };

    try {
      const updated = updateNodeRun(nodeRunId, {
        status: "done",
        finishedAt: new Date().toISOString(),
        outputArtifact: {
          text: artifact.text,
          diff: artifact.diff,
          extra: artifact.extra,
        },
        inputTokens: cumulativeUsage.inputTokens,
        outputTokens: cumulativeUsage.outputTokens,
        cacheReadTokens: cumulativeUsage.cacheReadTokens,
        cacheWriteTokens: cumulativeUsage.cacheWriteTokens,
      });
      if (updated) broadcastNodeFinished(updated);
    } catch (e) {
      console.error(`[graphRunner] updateNodeRun(done) failed:`, e);
    }

    prior = artifact;
    completedNodes += 1;
  }

  if (!prior) {
    throw new Error("graph produced no artifact");
  }

  return { finalArtifact: prior, completedNodes };
}

function finalizeNodeRunRow(
  nodeRunId: string,
  status: "error" | "aborted",
  errorMessage: string,
): void {
  try {
    const updated = updateNodeRun(nodeRunId, {
      status,
      finishedAt: new Date().toISOString(),
      errorMessage,
    });
    if (updated) broadcastNodeFinished(updated);
  } catch (e) {
    console.error(`[graphRunner] finalizeNodeRunRow(${status}) failed:`, e);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function pushLog(taskId: string, line: string): Promise<void> {
  await appendAgentLog(taskId, line);
  broadcastLog(taskId, line);
}
