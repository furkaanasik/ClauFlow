"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import clsx from "clsx";
import { useBoardStore } from "@/store/boardStore";
import type { NodeRun, NodeRunStatus } from "@/types";

const EMPTY_NODE_RUNS: Record<string, NodeRun> = Object.freeze({}) as Record<string, NodeRun>;
const EMPTY_LOG: string[] = Object.freeze([]) as unknown as string[];

const STATUS_DOT: Record<NodeRunStatus, string> = {
  running: "bg-blue-400 animate-pulse",
  done:    "bg-emerald-400",
  error:   "bg-rose-400",
  aborted: "bg-amber-400",
};

const STATUS_BORDER: Record<NodeRunStatus, string> = {
  running: "border-blue-500/60",
  done:    "border-emerald-500/60",
  error:   "border-rose-500/60",
  aborted: "border-amber-500/60",
};

const STATUS_LABEL: Record<NodeRunStatus, string> = {
  running: "running",
  done:    "done",
  error:   "error",
  aborted: "aborted",
};

interface MiniDagViewProps {
  taskId: string;
  noNodesLabel: string;
  nodeLogsTitle: string;
  nodeNoLogLabel: string;
}

export function MiniDagView({
  taskId,
  noNodesLabel,
  nodeLogsTitle,
  nodeNoLogLabel,
}: MiniDagViewProps) {
  const nodeRuns = useBoardStore((s) =>
    taskId ? s.nodeRuns[taskId] ?? EMPTY_NODE_RUNS : EMPTY_NODE_RUNS,
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const sortedRuns = useMemo(
    () =>
      Object.values(nodeRuns).sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
    [nodeRuns],
  );

  const selectedRun = selectedNodeId ? nodeRuns[selectedNodeId] : undefined;

  const liveLog = useBoardStore((s) =>
    taskId && selectedNodeId
      ? s.nodeLogs[taskId]?.[selectedNodeId] ?? EMPTY_LOG
      : EMPTY_LOG,
  );

  const persistedLog = useMemo(() => {
    if (liveLog.length > 0) return null;
    const raw = selectedRun?.outputArtifact?.logLines;
    return Array.isArray(raw) ? (raw as string[]) : null;
  }, [liveLog.length, selectedRun]);

  const log = liveLog.length > 0 ? liveLog : persistedLog ?? EMPTY_LOG;

  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log.length]);

  if (sortedRuns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 border border-dashed border-[var(--border)] text-sm text-[var(--text-faint)]">
        {noNodesLabel}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Node grid */}
      <div className="flex flex-wrap gap-2">
        {sortedRuns.map((run, idx) => {
          const isSelected = selectedNodeId === run.nodeId;
          const borderCls = STATUS_BORDER[run.status];
          return (
            <button
              key={run.nodeId}
              type="button"
              onClick={() =>
                setSelectedNodeId((prev) => (prev === run.nodeId ? null : run.nodeId))
              }
              className={clsx(
                "flex min-w-[120px] flex-col gap-1 border bg-[var(--bg-surface)] px-3 py-2 text-left transition hover:bg-[var(--bg-elevated)]",
                isSelected
                  ? `${borderCls} bg-[var(--bg-elevated)]`
                  : "border-[var(--border)]",
              )}
            >
              {/* index + node id */}
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-[var(--text-faint)]">
                  {idx + 1}
                </span>
                <span className="truncate font-mono text-[11px] font-semibold text-[var(--text-primary)]">
                  {run.nodeId}
                </span>
              </div>

              {/* status row */}
              <div className="flex items-center gap-1.5">
                <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[run.status])} />
                <span className="font-mono text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                  {STATUS_LABEL[run.status]}
                </span>
              </div>

              {/* token info if available */}
              {(run.inputTokens > 0 || run.outputTokens > 0) && (
                <span className="font-mono text-[9px] text-[var(--text-faint)]">
                  {run.inputTokens}↑ {run.outputTokens}↓
                </span>
              )}

              {run.errorMessage && (
                <span className="truncate font-mono text-[9px] text-rose-400">
                  {run.errorMessage}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Inline log panel */}
      {selectedNodeId && (
        <div className="flex min-h-0 flex-1 flex-col border border-[var(--border)] bg-[var(--bg-base)]">
          <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">
              {nodeLogsTitle} — <span className="text-[var(--text-primary)]">{selectedNodeId}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedNodeId(null)}
              className="text-[14px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Close log panel"
            >
              ×
            </button>
          </header>

          {selectedRun && (
            <div className="grid shrink-0 grid-cols-2 gap-x-2 gap-y-1 border-b border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
              <div>Status</div>
              <div className="font-mono">{selectedRun.status}</div>
              <div>Model</div>
              <div className="font-mono">{selectedRun.model ?? "—"}</div>
              <div>In / Out</div>
              <div className="font-mono">
                {selectedRun.inputTokens} / {selectedRun.outputTokens}
              </div>
              <div>Started</div>
              <div className="font-mono text-[10px]">
                {new Date(selectedRun.startedAt).toLocaleTimeString()}
              </div>
              {selectedRun.finishedAt && (
                <>
                  <div>Finished</div>
                  <div className="font-mono text-[10px]">
                    {new Date(selectedRun.finishedAt).toLocaleTimeString()}
                  </div>
                </>
              )}
              {selectedRun.errorMessage && (
                <>
                  <div className="text-rose-400">Error</div>
                  <div className="font-mono text-[10px] text-rose-400">
                    {selectedRun.errorMessage}
                  </div>
                </>
              )}
            </div>
          )}

          <pre
            ref={logRef}
            className="min-h-[120px] flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]"
          >
            {log.length > 0 ? log.join("\n") : nodeNoLogLabel}
          </pre>
        </div>
      )}
    </div>
  );
}
