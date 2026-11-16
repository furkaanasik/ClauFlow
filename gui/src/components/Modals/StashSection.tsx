"use client";

import clsx from "clsx";
import { useEffect, useId, useState } from "react";
import { FileBlock, parseDiffByFile, splitPath, type FileDiff } from "@/components/Github/DiffView";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconCode,
  IconEye,
  IconFile,
  IconFolder,
  IconRetry,
  IconShieldCheck,
  IconTrash,
} from "@/components/ui/icons";
import { ApiError, api } from "@/lib/api";
import { apiErrorCode, errorText } from "@/lib/errorText";
import { formatRelativeTime } from "@/lib/format";
import { refreshStashes } from "@/hooks/useStashes";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";
import type { StashDetail, StashEntry, StashFile, StashFileClass, StashGroup, StashSummary } from "@/types";

type T = ReturnType<typeof useTranslation>;

/** Translated error, plus the files of a `stash_conflict` / `worktree_dirty`. */
function stashErrorText(t: T, err: unknown): string {
  const body = err instanceof ApiError ? (err.body as { files?: unknown } | null) : null;
  const files = Array.isArray(body?.files) ? body.files.filter((f): f is string => typeof f === "string") : [];
  const text = errorText(t, err);
  return files.length > 0 ? `${text} ${t.board.mergeConflictFiles(files.join(", "))}` : text;
}

/** Dot colour per class (tokens only). */
const CLASS_DOT: Record<StashFileClass, string> = {
  code: "var(--orange)",
  deps: "var(--cobalt)",
  build: "var(--mustard)",
  lock_os: "var(--ink-3)",
};

function useNumber() {
  const lang = useBoardStore((st) => st.lang);
  return (n: number) => n.toLocaleString(lang === "tr" ? "tr-TR" : "en-US");
}

/** Class count pills ("Kod 3 · Bağımlılık 1 000 …"); zero classes are left out. */
function ClassCounts({ summary }: { summary: StashSummary }) {
  const d = useTranslation().stashes.detail;
  const num = useNumber();
  const items: Array<[StashFileClass, number]> = [
    ["code", summary.code],
    ["deps", summary.deps],
    ["build", summary.build],
    ["lock_os", summary.lockOs],
  ];
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid="stash-class-counts">
      {items
        .filter(([, n]) => n > 0)
        .map(([cls, n]) => (
          <li key={cls} className="ui-pill ui-pill--sm bg-panel text-ink" data-class={cls}>
            <span aria-hidden className="ui-dot !h-2 !w-2" style={{ "--dot": CLASS_DOT[cls] } as React.CSSProperties} />
            {d.classes[cls]}
            <span className="font-mono text-[0.9em] font-semibold tabular-nums text-ink-2">{num(n)}</span>
          </li>
        ))}
      {summary.untracked > 0 && (
        <li className="ui-pill ui-pill--sm bg-sunken text-ink-2">{d.untrackedCount(num(summary.untracked))}</li>
      )}
    </ul>
  );
}

/** "Nothing you wrote — safe" or "N files you may have written: …" (plan §5.4 (1)). */
function DecisionBanner({ detail }: { detail: StashDetail }) {
  const d = useTranslation().stashes.detail;
  if (detail.safeToDrop) {
    return (
      <div className="ui-banner ui-banner--info" data-testid="stash-safe-banner">
        <IconCheck size={15} className="mt-0.5 shrink-0" />
        <span className="font-semibold">{d.safeTitle}</span>
      </div>
    );
  }
  const names = detail.codeFiles.slice(0, 3).map((f) => splitPath(f.path).base);
  const more = detail.summary.code - names.length;
  return (
    <div className="ui-banner ui-banner--warn" data-testid="stash-code-banner">
      <IconAlert size={15} className="mt-0.5 shrink-0" />
      <span>{d.codeWarn(detail.summary.code, names.join(", "), more)}</span>
    </div>
  );
}

interface FileRowProps {
  projectId: string;
  stashRef: string;
  file: StashFile;
  restored: boolean;
  busy: boolean;
  disabled: boolean;
  onRestore: (path: string) => void;
}

/** One code / lock file: path, status letter, lazy diff and per-file restore. */
function FileRow({ projectId, stashRef, file, restored, busy, disabled, onRestore }: FileRowProps) {
  const t = useTranslation();
  const d = t.stashes.detail;
  const diffId = useId();
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<{ file: FileDiff | null; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const { dir, base } = splitPath(file.path);

  const toggleDiff = async () => {
    const next = !open;
    setOpen(next);
    if (!next || diff || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.getStashFileDiff(projectId, stashRef, file.path);
      setDiff({ file: parseDiffByFile(r.diff)[0] ?? null, truncated: r.truncated });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 py-2" data-testid="stash-file" data-path={file.path}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] border-line bg-sunken px-1 font-mono text-[10.5px] font-bold text-ink-2"
          title={d.status[file.status]}
        >
          {file.status}
          <span className="sr-only"> {d.status[file.status]}</span>
        </span>
        <code className="min-w-[11rem] flex-1 break-all font-mono text-[12px]" title={file.path}>
          <span className="text-ink-3">{dir}</span>
          <span className="font-bold text-ink">{base}</span>
        </code>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {restored && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[var(--green-text)]">
              <IconCheck size={12} />
              {d.restoredMark}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<IconEye size={14} />}
            aria-expanded={open}
            aria-controls={diffId}
            onClick={() => void toggleDiff()}
            data-testid="stash-file-diff"
          >
            {open ? d.hideDiff : d.showDiff}
          </Button>
          {file.status !== "D" && (
            <Button
              size="sm"
              variant="secondary"
              icon={<IconRetry size={14} />}
              loading={busy}
              disabled={disabled}
              onClick={() => onRestore(file.path)}
              data-testid="stash-file-restore"
            >
              {d.restoreFile}
            </Button>
          )}
        </span>
      </div>
      {open && (
        <div id={diffId}>
          {loading && <div className="ui-hatch h-10 rounded-[10px] border-2 border-dashed border-line" aria-busy />}
          {error && (
            <div role="alert" className="ui-banner ui-banner--error">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {diff && !diff.file && <p className="text-[12.5px] text-ink-2">{d.diffEmpty}</p>}
          {diff?.file && (
            <div className="stash-diff">
              <FileBlock
                file={diff.file}
                index={0}
                isViewed={false}
                isExpanded={expanded}
                onToggleViewed={() => {}}
                onToggleExpanded={() => setExpanded((e) => !e)}
                registerRef={() => {}}
                hideViewed
              />
            </div>
          )}
          {diff?.truncated && (
            <div className="ui-banner ui-banner--warn mt-2">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span>{d.diffTruncated}</span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** A folded noise group ("node_modules/ · Bağımlılık · 12 431 dosya"); paths only, no diff. */
function GroupRow({ group }: { group: StashGroup }) {
  const d = useTranslation().stashes.detail;
  const num = useNumber();
  const listId = useId();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-1.5" data-testid="stash-group" data-root={group.root}>
      <button
        type="button"
        className="ui-focus flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] px-1 py-1 text-left hover:bg-sunken"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <IconChevronRight size={13} className={clsx("shrink-0 transition-transform", open && "rotate-90")} />
        <IconFolder size={14} className="shrink-0 text-ink-2" />
        <code className="break-all font-mono text-[12px] font-bold text-ink">{group.root}</code>
        <span className="text-[12px] text-ink-2">· {d.classes[group.class]}</span>
        <span className="font-mono text-[11.5px] tabular-nums text-ink-2">· {d.fileCount(num(group.count))}</span>
      </button>
      {open && (
        <div id={listId} className="mt-1.5 pl-7">
          <ul className="max-h-60 overflow-y-auto rounded-[8px] border-[1.5px] border-line bg-sunken px-2.5 py-1.5 font-mono text-[11.5px] text-ink-2">
            {group.sample.map((p) => (
              <li key={p} className="break-all py-px">
                {p}
              </li>
            ))}
          </ul>
          {group.count > group.sample.length && (
            <p className="mt-1 text-[11.5px] text-ink-2">{d.sampleNote(num(group.sample.length), num(group.count))}</p>
          )}
        </div>
      )}
    </li>
  );
}

/** Sub-heading inside the open panel ("Kod · 3"). */
function PanelHead({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  const num = useNumber();
  return (
    <h4 className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
      {icon}
      {label}
      <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-2">{num(count)}</span>
    </h4>
  );
}

/**
 * bakim #6 (plan §5.4): the open stash panel. Loads `GET …/files` once; a
 * file's diff is fetched only when asked; noise folders stay folded.
 */
function StashDetailPanel({ projectId, stash, id }: { projectId: string; stash: StashEntry; id: string }) {
  const t = useTranslation();
  const d = t.stashes.detail;
  const toast = useToast();
  const [detail, setDetail] = useState<StashDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [restored, setRestored] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    api
      .getStashFiles(projectId, stash.ref)
      .then((r) => alive && setDetail(r))
      .catch((err) => alive && setLoadError(errorText(t, err)));
    return () => {
      alive = false;
    };
    // `t` changes with the language only; the detail does not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, stash.ref]);

  const restoreFile = async (path: string) => {
    setBusyPath(path);
    setError(null);
    try {
      await api.restoreStashFile(projectId, stash.ref, path);
      setRestored((s) => new Set(s).add(path));
      toast.success(d.fileRestoredToast(path));
      void api
        .getProjectGitStatus(projectId)
        .then((st) => useBoardStore.getState().setProjectGitStatus(projectId, st))
        .catch(() => {});
    } catch (err) {
      setError(apiErrorCode(err) === "worktree_dirty" ? d.fileDirty(path) : stashErrorText(t, err));
    } finally {
      setBusyPath(null);
    }
  };

  const fileRows = (files: StashFile[]) => (
    <ul className="divide-y-[1.5px] divide-hair">
      {files.map((f) => (
        <FileRow
          key={f.path}
          projectId={projectId}
          stashRef={stash.ref}
          file={f}
          restored={restored.has(f.path)}
          busy={busyPath === f.path}
          disabled={busyPath !== null}
          onRestore={(p) => void restoreFile(p)}
        />
      ))}
    </ul>
  );

  return (
    <div id={id} className="flex w-full flex-col gap-3 border-t-2 border-hair pt-3" data-testid="stash-detail">
      {!detail && !loadError && (
        <p className="ui-hatch rounded-[10px] border-2 border-dashed border-line px-3 py-2 text-[12.5px] text-ink-2" aria-busy>
          {d.loading}
        </p>
      )}
      {loadError && (
        <div role="alert" className="ui-banner ui-banner--error">
          <IconAlert size={15} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}
      {detail && (
        <>
          <DecisionBanner detail={detail} />
          <ClassCounts summary={detail.summary} />
          {error && (
            <div role="alert" className="ui-banner ui-banner--error whitespace-pre-wrap break-words">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {detail.summary.total === 0 && <p className="text-[12.5px] text-ink-2">{d.empty}</p>}
          {detail.codeFiles.length > 0 && (
            <section>
              <PanelHead icon={<IconCode size={14} />} label={d.codeHeading} count={detail.summary.code} />
              {fileRows(detail.codeFiles)}
            </section>
          )}
          {detail.lockOsFiles.length > 0 && (
            <section>
              <PanelHead icon={<IconFile size={14} />} label={d.lockHeading} count={detail.summary.lockOs} />
              {fileRows(detail.lockOsFiles)}
            </section>
          )}
          {detail.groups.length > 0 && (
            <section>
              <PanelHead
                icon={<IconFolder size={14} />}
                label={d.noiseHeading}
                count={detail.groups.reduce((n, g) => n + g.count, 0)}
              />
              <ul>
                {detail.groups.map((g) => (
                  <GroupRow key={`${g.class}:${g.root}`} group={g} />
                ))}
              </ul>
            </section>
          )}
          {detail.truncated && <p className="text-[12px] text-ink-2">{d.truncatedNote}</p>}
        </>
      )}
    </div>
  );
}

/**
 * zincir E6 (plan §3/27, §5.9) + bakim #6 (§5.4): the stash rows of the
 * project drawer. The row head is a disclosure button ("<reason> · CLF-n",
 * time, file count, "Safe" badge) that opens the stash's detail panel;
 * "Restore" and "Drop" (behind a danger `ConfirmDialog`) stay on the row.
 * Errors are core codes (`stash_conflict`, `worktree_dirty`, `repo_busy`,
 * `stash_not_found`, `stash_file_*`).
 */
export function StashList({ projectId, stashes }: { projectId: string; stashes: StashEntry[] }) {
  const t = useTranslation();
  const s = t.stashes;
  const lang = useBoardStore((st) => st.lang);
  const toast = useToast();
  const baseId = useId();

  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<StashEntry | null>(null);
  const [openRefs, setOpenRefs] = useState<Set<string>>(() => new Set());

  const toggle = (ref: string) =>
    setOpenRefs((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

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
        {stashes.map((stash, i) => {
          const busy = busyRef === stash.ref;
          const open = openRefs.has(stash.ref);
          const panelId = `${baseId}-stash-${i}`;
          const total = stash.summary?.total ?? stash.files.length;
          return (
            <li
              key={stash.ref}
              className="ui-row !flex-wrap !gap-x-3 !gap-y-2"
              data-testid="stash-row"
              data-open={open ? "true" : undefined}
            >
              <div className="min-w-0 flex-1 basis-[14rem]">
                <button
                  type="button"
                  className="ui-focus -mx-1 flex max-w-full items-start gap-1.5 rounded-[8px] px-1 text-left"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggle(stash.ref)}
                  data-testid="stash-toggle"
                >
                  <IconChevronRight
                    size={13}
                    className={clsx("mt-[3px] shrink-0 text-ink-2 transition-transform", open && "rotate-90")}
                  />
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-[13px] font-semibold text-ink">
                    <span className="min-w-0">{s.reason[stash.reason] ?? stash.reason}</span>
                    {stash.displayId && <span className="shrink-0 font-mono text-ink-2">· {stash.displayId}</span>}
                    <span className="sr-only">· {open ? s.detail.hide : s.detail.show}</span>
                  </span>
                </button>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[19px] font-mono text-[11.5px] text-ink-3">
                  <time dateTime={stash.createdAt}>{formatRelativeTime(stash.createdAt, lang)}</time>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1" title={stash.files.join("\n")}>
                    <IconFile size={11} />
                    {s.files(total)}
                  </span>
                  {stash.safeToDrop && (
                    <span
                      className="ui-pill ui-pill--sm !h-5 !border-[1.5px] bg-panel !px-1.5 font-sans text-[11px] text-[var(--green-text)]"
                      title={s.detail.safeBadgeTitle}
                      data-testid="stash-safe-badge"
                    >
                      <IconShieldCheck size={12} />
                      {s.detail.safeBadge}
                    </span>
                  )}
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
              {open && <StashDetailPanel projectId={projectId} stash={stash} id={panelId} />}
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
