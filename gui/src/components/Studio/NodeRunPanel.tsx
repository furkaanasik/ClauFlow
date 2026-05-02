"use client";

import { useBoardStore } from "@/store/boardStore";

const EMPTY_LOG: string[] = Object.freeze([]) as unknown as string[];

interface NodeRunPanelProps {
  taskId: string | null;
  nodeId: string | null;
  onClose: () => void;
}

export function NodeRunPanel({ taskId, nodeId, onClose }: NodeRunPanelProps) {
  const run = useBoardStore((s) =>
    taskId && nodeId ? s.nodeRuns[taskId]?.[nodeId] : undefined,
  );
  const liveLog = useBoardStore((s) =>
    taskId && nodeId
      ? s.nodeLogs[taskId]?.[nodeId] ?? EMPTY_LOG
      : EMPTY_LOG,
  );
  const persistedLog = (() => {
    if (liveLog.length > 0) return null;
    const raw = run?.outputArtifact?.logLines;
    return Array.isArray(raw) ? (raw as string[]) : null;
  })();
  const log = liveLog.length > 0 ? liveLog : persistedLog ?? EMPTY_LOG;

  if (!taskId || !nodeId) return null;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="font-mono text-[12px] text-[var(--text-primary)]">
          {nodeId}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[14px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          aria-label="Close panel"
        >
          ×
        </button>
      </header>

      {run ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 border-b border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          <div>Status</div>
          <div className="font-mono">{run.status}</div>
          <div>Model</div>
          <div className="font-mono">{run.model ?? "—"}</div>
          <div>In/Out</div>
          <div className="font-mono">
            {run.inputTokens} / {run.outputTokens}
          </div>
          <div>Started</div>
          <div className="font-mono text-[10px]">{run.startedAt}</div>
          {run.finishedAt && (
            <>
              <div>Finished</div>
              <div className="font-mono text-[10px]">{run.finishedAt}</div>
            </>
          )}
          {run.errorMessage && (
            <>
              <div className="text-rose-500">Error</div>
              <div className="font-mono text-[10px] text-rose-500">
                {run.errorMessage}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-faint)]">
          No run yet for this node.
        </div>
      )}

      <pre className="flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
        {log.length > 0 ? log.join("\n") : "(no log lines yet)"}
      </pre>
    </aside>
  );
}
