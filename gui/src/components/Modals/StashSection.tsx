"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconAlert, IconFile, IconRetry, IconTrash } from "@/components/ui/icons";
import { ApiError, api } from "@/lib/api";
import { errorText } from "@/lib/errorText";
import { formatRelativeTime } from "@/lib/format";
import { refreshStashes } from "@/hooks/useStashes";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";
import type { StashEntry } from "@/types";

/** Translated error, plus the files of a `stash_conflict`. */
function stashErrorText(t: ReturnType<typeof useTranslation>, err: unknown): string {
  const body = err instanceof ApiError ? (err.body as { files?: unknown } | null) : null;
  const files = Array.isArray(body?.files) ? body.files.filter((f): f is string => typeof f === "string") : [];
  const text = errorText(t, err);
  return files.length > 0 ? `${text} ${t.board.mergeConflictFiles(files.join(", "))}` : text;
}

/**
 * zincir E6 (plan §3/27, §5.9): the stash rows of the project drawer. Each row
 * reads "<reason> · CLF-n · 5 min ago", the file count (first 20 files in
 * `title`), "Restore" and "Drop" (behind a danger `ConfirmDialog`). Errors are
 * core codes (`stash_conflict`, `worktree_dirty`, `repo_busy`, `stash_not_found`).
 */
export function StashList({ projectId, stashes }: { projectId: string; stashes: StashEntry[] }) {
  const t = useTranslation();
  const s = t.stashes;
  const lang = useBoardStore((st) => st.lang);
  const toast = useToast();

  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<StashEntry | null>(null);

  const refreshGit = () =>
    api
      .getProjectGitStatus(projectId)
      .then((st) => useBoardStore.getState().setProjectGitStatus(projectId, st))
      .catch(() => {});

  const restore = async (stash: StashEntry) => {
    setBusyRef(stash.ref);
    setError(null);
    try {
      await api.restoreStash(projectId, stash.ref);
      toast.success(s.restored);
      void refreshGit();
    } catch (err) {
      setError(stashErrorText(t, err));
    } finally {
      setBusyRef(null);
      void refreshStashes(projectId);
    }
  };

  const drop = async (stash: StashEntry) => {
    setConfirmDrop(null);
    setBusyRef(stash.ref);
    setError(null);
    try {
      await api.dropStash(projectId, stash.ref);
      toast.success(s.dropped);
    } catch (err) {
      setError(stashErrorText(t, err));
    } finally {
      setBusyRef(null);
      void refreshStashes(projectId);
    }
  };

  return (
    <>
      {error && (
        <div role="alert" className="ui-banner ui-banner--error mb-3 whitespace-pre-wrap break-words">
          <IconAlert size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <ul className="flex flex-col gap-2.5" data-testid="stash-list">
        {stashes.map((stash) => {
          const busy = busyRef === stash.ref;
          return (
            <li key={stash.ref} className="ui-row !flex-wrap !gap-x-3 !gap-y-2" data-testid="stash-row">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">
                  {s.reason[stash.reason] ?? stash.reason}
                  {stash.displayId && <span className="font-mono text-ink-2"> · {stash.displayId}</span>}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[11.5px] text-ink-3">
                  <time dateTime={stash.createdAt}>{formatRelativeTime(stash.createdAt, lang)}</time>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1" title={stash.files.join("\n")}>
                    <IconFile size={11} />
                    {s.files(stash.files.length)}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<IconRetry size={14} />}
                  loading={busy}
                  disabled={busyRef !== null}
                  onClick={() => void restore(stash)}
                >
                  {s.restore}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<IconTrash size={14} />}
                  disabled={busyRef !== null}
                  onClick={() => setConfirmDrop(stash)}
                >
                  {s.drop}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmDrop !== null}
        title={s.dropConfirmTitle}
        description={confirmDrop ? s.dropConfirmBody(confirmDrop.label) : undefined}
        confirmLabel={s.drop}
        cancelLabel={t.projectDetail.cancel}
        variant="danger"
        onConfirm={() => confirmDrop && void drop(confirmDrop)}
        onCancel={() => setConfirmDrop(null)}
      />
    </>
  );
}
