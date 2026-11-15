import type { AgentText, TeamArtifact, TeamRun, ToolCall } from "@/types";

/**
 * A8b: a fetch response can arrive after WebSocket events that are newer than
 * it. Instead of replacing the store slice, merge by id: items only one side
 * knows are kept, and when both know an item `pickNewer` decides. The result
 * keeps the fetched order, with live-only items appended in their store order.
 */
export function mergeById<T, K extends string | number>(
  current: readonly T[] | undefined,
  fetched: readonly T[],
  idOf: (item: T) => K,
  pickNewer: (stored: T, fetched: T) => T,
): T[] {
  const stored = new Map<K, T>();
  for (const item of current ?? []) stored.set(idOf(item), item);
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of fetched) {
    const id = idOf(item);
    seen.add(id);
    const mine = stored.get(id);
    out.push(mine === undefined ? item : pickNewer(mine, item));
  }
  for (const item of current ?? []) {
    if (!seen.has(idOf(item))) out.push(item);
  }
  return out;
}

const TERMINAL_RUN = new Set<TeamRun["status"]>(["delivered", "explored", "stuck", "error", "aborted"]);

/** A run only moves forward: terminal beats live, later finish/qaRound/cost wins. */
export function newerTeamRun(a: TeamRun, b: TeamRun): TeamRun {
  const ta = TERMINAL_RUN.has(a.status);
  const tb = TERMINAL_RUN.has(b.status);
  if (ta !== tb) return ta ? a : b;
  if ((a.finishedAt ?? "") !== (b.finishedAt ?? "")) return (a.finishedAt ?? "") > (b.finishedAt ?? "") ? a : b;
  if (a.qaRound !== b.qaRound) return a.qaRound > b.qaRound ? a : b;
  if (a.costUsd !== b.costUsd) return a.costUsd > b.costUsd ? a : b;
  return b;
}

/** Artifacts are written once; the only later change is approval (with an edited body). */
export function newerTeamArtifact(a: TeamArtifact, b: TeamArtifact): TeamArtifact {
  if (!!a.approved !== !!b.approved) return a.approved ? a : b;
  return b;
}

/** A tool call goes running → done/error once. */
export function newerToolCall(a: ToolCall, b: ToolCall): ToolCall {
  const fa = a.status !== "running";
  const fb = b.status !== "running";
  if (fa !== fb) return fa ? a : b;
  return b;
}

/** Agent texts never change after insert. */
export function newerAgentText(_a: AgentText, b: AgentText): AgentText {
  return b;
}
