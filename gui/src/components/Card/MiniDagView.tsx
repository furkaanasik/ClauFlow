"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useBoardStore } from "@/store/boardStore";
import { IconButton } from "@/components/ui/Button";
import { StatusPill, type StatusKind } from "@/components/ui/Pills";
import { IconChevronRight, IconClose, IconFlow, IconRobot } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { LogViewer } from "@/components/Card/LogViewer";
import type { NodeRun, NodeRunStatus } from "@/types";

const EMPTY_NODE_RUNS: Record<string, NodeRun> = Object.freeze({}) as Record<string, NodeRun>;
const EMPTY_LOG: string[] = Object.freeze([]) as unknown as string[];

const STATUS_KIND: Record<NodeRunStatus, StatusKind> = {
  running: "doing",
  done: "done",
  error: "error",
  aborted: "review",
};

const STATUS_FILL: Record<NodeRunStatus, string> = {
  running: "var(--orange)",
  done: "var(--green)",
  error: "var(--red)",
  aborted: "var(--mustard)",
};

interface MiniDagViewProps {
  taskId: string;
  noNodesLabel: string;
  nodeLogsTitle: string;
  nodeNoLogLabel: string;
}

function nodeName(run: NodeRun, fallback: string): string {
  if (run.nodeType === "subagent") {
    return typeof run.inputArtifact?.subagent_type === "string" ? run.inputArtifact.subagent_type : fallback;
  }
  return run.nodeId;
}

/**
 * Graph-mode run as a left-to-right strip of station cards (status cap on
 * top, tokens underneath). Selecting a node opens its meta + live log.
 */
export function MiniDagView({ taskId, noNodesLabel, nodeLogsTitle, nodeNoLogLabel }: MiniDagViewProps) {
  const t = useTranslation();
  const f = t.flow;
  const nodeRuns = useBoardStore((s) => (taskId ? s.nodeRuns[taskId] ?? EMPTY_NODE_RUNS : EMPTY_NODE_RUNS));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const sortedRuns = useMemo(
    () => Object.values(nodeRuns).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    [nodeRuns],
  );

  const selectedRun = selectedNodeId ? nodeRuns[selectedNodeId] : undefined;

  const liveLog = useBoardStore((s) =>
    taskId && selectedNodeId ? s.nodeLogs[taskId]?.[selectedNodeId] ?? EMPTY_LOG : EMPTY_LOG,
  );

  const persistedLog = useMemo(() => {
    if (liveLog.length > 0) return null;
    const raw = selectedRun?.outputArtifact?.logLines;
    return Array.isArray(raw) ? (raw as string[]) : null;
  }, [liveLog.length, selectedRun]);

  const log = liveLog.length > 0 ? liveLog : persistedLog ?? EMPTY_LOG;
  const statusLabel: Record<NodeRunStatus, string> = {
    running: f.running,
    done: f.done,
    error: f.error,
    aborted: f.aborted,
  };

  if (sortedRuns.length === 0) {
    return (
      <div className="ui-hatch flex flex-1 flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-12 text-center">
        <span
          aria-hidden
          className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-panel text-ink-2 shadow-hard"
        >
          <IconFlow size={20} />
        </span>
        <p className="max-w-xs text-[13px] text-ink-2">{noNodesLabel}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="t-label">{f.nodes(sortedRuns.length)}</span>
        <span className="h-[2px] flex-1 rounded bg-hair" aria-hidden />
      </div>

      {/* Station strip */}
      <div className="flex flex-wrap items-stretch gap-x-1.5 gap-y-4 pb-1 pr-1">
        {sortedRuns.map((run, idx) => {
          const isSelected = selectedNodeId === run.nodeId;
          const isSub = run.nodeType === "subagent";
          return (
            <div key={run.nodeId} className="flex items-stretch gap-1.5">
              {idx > 0 && <IconChevronRight size={16} className="flow-link" aria-hidden />}
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedNodeId((prev) => (prev === run.nodeId ? null : run.nodeId))}
                className="flow-node"
                style={{ "--flow": STATUS_FILL[run.status] } as CSSProperties}
              >
                <span className="mt-1 flex items-center gap-1.5">
                  <span className="font-mono text-[10px] font-bold text-ink-3">{String(idx + 1).padStart(2, "0")}</span>
                  {isSub && <IconRobot size={12} className="text-[var(--cobalt-text)]" />}
                  <span className="min-w-0 truncate font-mono text-[12px] font-bold text-ink">
                    {nodeName(run, f.subagent)}
                  </span>
                </span>
                {isSub && typeof run.inputArtifact?.description === "string" && (
                  <span className="line-clamp-2 text-[11.5px] leading-snug text-ink-2">{run.inputArtifact.description}</span>
                )}
                <span className="flex items-center gap-2">
                  <StatusPill status={STATUS_KIND[run.status]} live={run.status === "running"} className="!h-5 !px-2 !text-[10.5px]">
                    {statusLabel[run.status]}
                  </StatusPill>
                  {(run.inputTokens > 0 || run.outputTokens > 0) && (
                    <span className="font-mono text-[10px] text-ink-3">
                      {run.inputTokens}↑ {run.outputTokens}↓
                    </span>
                  )}
                </span>
                {run.errorMessage && (
                  <span className="truncate font-mono text-[10.5px] text-[var(--red-text)]">{run.errorMessage}</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Node detail */}
      {selectedNodeId && (
        <section className="ui-tabpanel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border-2 border-line bg-panel shadow-hard">
          <header className="flex shrink-0 items-center gap-2 border-b-2 border-line px-3 py-2">
            <span className="t-label">{nodeLogsTitle}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold text-ink">
              {selectedRun ? nodeName(selectedRun, selectedNodeId) : selectedNodeId}
            </span>
            <IconButton label={f.closeLog} size="sm" variant="ghost" onClick={() => setSelectedNodeId(null)}>
              <IconClose size={13} />
            </IconButton>
          </header>

          {selectedRun && (
            <dl className="grid shrink-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b-2 border-dashed border-hair px-4 py-3 text-[12px]">
              {selectedRun.nodeType === "subagent" && typeof selectedRun.inputArtifact?.subagent_type === "string" && (
                <>
                  <dt className="t-label self-center">{f.agent}</dt>
                  <dd className="font-mono text-[var(--cobalt-text)]">{selectedRun.inputArtifact.subagent_type}</dd>
                </>
              )}
              {selectedRun.nodeType === "subagent" && typeof selectedRun.inputArtifact?.description === "string" && (
                <>
                  <dt className="t-label self-center">{f.task}</dt>
                  <dd className="leading-snug text-ink-2">{selectedRun.inputArtifact.description}</dd>
                </>
              )}
              <dt className="t-label self-center">{f.status}</dt>
              <dd>
                <StatusPill status={STATUS_KIND[selectedRun.status]} live={selectedRun.status === "running"} className="!h-5 !px-2 !text-[10.5px]">
                  {statusLabel[selectedRun.status]}
                </StatusPill>
              </dd>
              <dt className="t-label self-center">{f.model}</dt>
              <dd className="font-mono text-ink">{selectedRun.model ?? "—"}</dd>
              <dt className="t-label self-center">{f.inOut}</dt>
              <dd className="font-mono text-ink">
                {selectedRun.inputTokens} / {selectedRun.outputTokens}
              </dd>
              <dt className="t-label self-center">{f.started}</dt>
              <dd className="font-mono text-ink-2">{new Date(selectedRun.startedAt).toLocaleTimeString()}</dd>
              {selectedRun.finishedAt && (
                <>
                  <dt className="t-label self-center">{f.finished}</dt>
                  <dd className="font-mono text-ink-2">{new Date(selectedRun.finishedAt).toLocaleTimeString()}</dd>
                </>
              )}
              {selectedRun.errorMessage && (
                <>
                  <dt className="t-label self-center !text-[var(--red-text)]">{f.error2}</dt>
                  <dd className="font-mono text-[var(--red-text)]">{selectedRun.errorMessage}</dd>
                </>
              )}
            </dl>
          )}

          <LogViewer
            lines={log}
            follow
            live={selectedRun?.status === "running"}
            followLabel={t.taskDetail.follow}
            emptyLabel={nodeNoLogLabel}
            className="m-3 min-h-[160px] flex-1"
            ariaLabel={nodeLogsTitle}
          />
        </section>
      )}
    </div>
  );
}
