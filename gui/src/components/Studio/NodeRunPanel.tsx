"use client";

import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { LogViewer } from "@/components/Card/LogViewer";
import { IconButton } from "@/components/ui/Button";
import { StatusPill, type StatusKind } from "@/components/ui/Pills";
import { IconAlert, IconClose, IconTerminal } from "@/components/ui/icons";
import type { NodeRunStatus } from "@/types";

const EMPTY_LOG: string[] = Object.freeze([]) as unknown as string[];

const RUN_KIND: Record<NodeRunStatus, StatusKind> = {
  running: "doing",
  done: "done",
  error: "error",
  aborted: "review",
};

interface NodeRunPanelProps {
  taskId: string | null;
  nodeId: string | null;
  onClose: () => void;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function NodeRunPanel({ taskId, nodeId, onClose }: NodeRunPanelProps) {
  const st = useTranslation().studio;
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

  const rows: [string, string][] = run
    ? [
        [st.metaModel, run.model ?? "—"],
        [st.metaTokens, `${run.inputTokens.toLocaleString()} / ${run.outputTokens.toLocaleString()}`],
        [st.metaStarted, fmtTime(run.startedAt)],
        ...(run.finishedAt ? ([[st.metaFinished, fmtTime(run.finishedAt)]] as [string, string][]) : []),
      ]
    : [];

  return (
    <aside className="studio-runpanel flex w-[360px] shrink-0 flex-col border-l-2 border-line bg-panel">
      <header className="flex items-center gap-2.5 border-b-2 border-line px-3.5 py-2.5">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border-2 border-line bg-ink text-[var(--on-ink)]"
          style={{ boxShadow: "2px 2px 0 var(--mustard)" }}
        >
          <IconTerminal size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="t-label !text-[10px]">{st.nodeRun}</span>
          <span className="truncate font-mono text-[13px] font-bold text-ink">{nodeId}</span>
        </div>
        {run && (
          <StatusPill status={RUN_KIND[run.status]} live={run.status === "running"}>
            {st.runStatus[run.status]}
          </StatusPill>
        )}
        <IconButton label={st.closePanel} size="sm" onClick={onClose}>
          <IconClose size={13} />
        </IconButton>
      </header>

      {run ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b-2 border-dashed border-hair px-3.5 py-3 text-[12px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="truncate text-right font-mono text-ink">{v}</dd>
            </div>
          ))}
          {run.errorMessage && (
            <div className="col-span-2 mt-1.5 ui-banner ui-banner--error !py-2 !text-[12px]">
              <IconAlert size={13} className="mt-0.5 shrink-0" />
              <span className="font-mono">{run.errorMessage}</span>
            </div>
          )}
        </dl>
      ) : (
        <div className="ui-hatch border-b-2 border-dashed border-hair px-3.5 py-3 text-[12px] text-ink-3">
          {st.noRunYet}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <LogViewer
          lines={log}
          live={run?.status === "running"}
          follow
          followLabel={st.follow}
          emptyLabel={st.noLogLines}
          ariaLabel={st.nodeLog}
          className="min-h-0 flex-1"
        />
      </div>
    </aside>
  );
}
