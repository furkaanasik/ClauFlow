"use client";

import { useEffect, useMemo, useState } from "react";
import { ChangeBar, FileBlock, parseDiffByFile, type FileDiff } from "@/components/Github/DiffView";
import { IconAlert, IconBranch, IconInfo } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errorText";
import type { Task, TaskDiff } from "@/types";

/**
 * D1: a task without a PR (no remote) is reviewed here, on the local diff of
 * its branch against base. Refetched whenever the task row changes (a comment
 * run adds commits to the branch).
 */
export function LocalChangesTab({ task }: { task: Task }) {
  const t = useTranslation();
  const td = t.taskDetail;
  const [data, setData] = useState<TaskDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api
      .getTaskDiff(task.id)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(t, err));
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.branch, task.updatedAt, t]);

  const files = useMemo<FileDiff[]>(() => (data ? parseDiffByFile(data.diff) : []), [data]);
  const added = files.reduce((n, f) => n + f.additions, 0);
  const removed = files.reduce((n, f) => n + f.deletions, 0);

  const toggle = (set: (fn: (s: Set<string>) => Set<string>) => void, name: string) =>
    set((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (error && !data) {
    return (
      <div role="alert" className="ui-banner ui-banner--error">
        <IconAlert size={15} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="ui-hatch h-4 rounded-[4px] border-[1.5px] border-dashed border-hair"
            style={{ width: `${55 + ((i * 37) % 45)}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <code
          title={data.branch}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[8px] border-2 border-line bg-sunken px-2 py-1 font-mono text-[11.5px] text-ink"
        >
          <IconBranch size={13} className="shrink-0 text-ink-3" />
          <span className="truncate">{data.branch}</span>
          <span className="shrink-0 text-ink-3">→ {data.base}</span>
        </code>
        <span className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold tabular-nums">
          <span className="font-sans font-medium text-ink-2">{td.changesFiles(files.length)}</span>
          <span className="text-[var(--green-text)]">+{added}</span>
          <span className="text-[var(--red-text)]">−{removed}</span>
          <ChangeBar add={added} del={removed} />
        </span>
      </div>

      {task.status === "review" && (
        <p className="ui-banner ui-banner--info">
          <IconInfo size={15} className="mt-0.5 shrink-0" />
          <span>{td.changesLocalNote(data.base)}</span>
        </p>
      )}

      {data.truncated && (
        <p className="ui-banner ui-banner--warn">
          <IconAlert size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{td.changesTruncated(data.base, data.branch)}</span>
        </p>
      )}

      {data.stat && (
        <section>
          <span className="t-label !text-[10px]">{td.changesStatLabel}</span>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-[12px] border-2 border-line bg-sunken px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {data.stat}
          </pre>
        </section>
      )}

      {files.length === 0 ? (
        <p className="ui-hatch rounded-[14px] border-2 border-dashed border-line px-6 py-10 text-center text-[13px] text-ink-2">
          {td.changesEmpty}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {files.map((file, idx) => (
            <FileBlock
              key={`${file.filename}-${idx}`}
              file={file}
              index={idx}
              isViewed={viewed.has(file.filename)}
              isExpanded={!collapsed.has(file.filename)}
              onToggleViewed={() => toggle(setViewed, file.filename)}
              onToggleExpanded={() => toggle(setCollapsed, file.filename)}
              registerRef={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}
