"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import clsx from "clsx";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/Pills";
import { Avatar } from "@/components/ui/Avatar";
import {
  IconAlert,
  IconArrowUpRight,
  IconCheck,
  IconFile,
  IconPR,
  IconRetry,
} from "@/components/ui/icons";
import { githubApi, type PRListItem, type PRDetails } from "@/lib/api";
import { PR_STATE_STYLES, prState } from "@/lib/githubConstants";
import { ChangeBar, FileBlock, parseDiffByFile, splitPath, type FileDiff } from "@/components/Github/DiffView";
import { errorText } from "@/lib/errorText";
import { useTranslation } from "@/hooks/useTranslation";

export type PullRequest = PRListItem;

interface PRDetailDrawerProps {
  pr: PullRequest;
  projectId: string;
  onClose: () => void;
  onMerged: () => void;
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export function PRDetailDrawer({ pr, projectId, onClose, onMerged }: PRDetailDrawerProps) {
  const t = useTranslation();
  const tp = t.prs;
  const [details, setDetails] = useState<PRDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const state = prState(pr.state);
  const stateStyle = PR_STATE_STYLES[state];
  const loading = detailsLoading || diffLoading;

  const fetchDetails = useCallback(async () => {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const data = await githubApi.getPRDetails(pr.number, projectId);
      setDetails(data);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setDetailsLoading(false);
    }
  }, [pr.number, projectId]);

  const fetchDiff = useCallback(async () => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const data = await githubApi.getPRDiff(pr.number, projectId);
      setDiff(data.diff ?? "");
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setDiffLoading(false);
    }
  }, [pr.number, projectId]);

  useEffect(() => {
    fetchDetails();
    fetchDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const files = useMemo<FileDiff[]>(() => (diff ? parseDiffByFile(diff) : []), [diff]);

  const handleMerge = async () => {
    setConfirmMerge(false);
    setMerging(true);
    setMergeError(null);
    try {
      await githubApi.mergePR(pr.number, projectId);
      onMerged();
      onClose();
    } catch (err) {
      setMergeError(errorText(t, err, tp.mergeFailed));
    } finally {
      setMerging(false);
    }
  };

  const scrollToFile = (filename: string) => {
    const el = fileRefs.current[filename];
    const container = scrollContainerRef.current;
    if (!el || !container) return;
    // open the file if collapsed
    setCollapsedFiles((s) => {
      if (!s.has(filename)) return s;
      const next = new Set(s);
      next.delete(filename);
      return next;
    });
    requestAnimationFrame(() => {
      const elTop = el.offsetTop;
      container.scrollTo({ top: elTop - 8, behavior: "smooth" });
    });
  };

  const toggleViewed = (filename: string) => {
    setViewedFiles((s) => {
      const next = new Set(s);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
        // collapse after marking viewed
        setCollapsedFiles((c) => {
          const cn = new Set(c);
          cn.add(filename);
          return cn;
        });
        // jump to next unviewed file
        const idx = files.findIndex((f) => f.filename === filename);
        const nextFile = files
          .slice(idx + 1)
          .find((f) => !next.has(f.filename));
        if (nextFile) {
          requestAnimationFrame(() => scrollToFile(nextFile.filename));
        }
      }
      return next;
    });
  };

  const toggleExpanded = (filename: string) => {
    setCollapsedFiles((s) => {
      const next = new Set(s);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const viewedCount = viewedFiles.size;
  const totalFiles = files.length;
  const allViewed = totalFiles > 0 && viewedCount === totalFiles;
  const createdAt = (() => {
    const d = new Date(pr.createdAt);
    return Number.isNaN(d.getTime()) ? pr.createdAt : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  })();

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="full"
        eyebrow={
          <>
            <span className="ui-keyplate">#{pr.number}</span>
            {pr.repository && <span className="truncate">{pr.repository.nameWithOwner}</span>}
          </>
        }
        title={pr.title}
        meta={
          <>
            <StatusPill status={stateStyle.status} variant="solid" icon={<IconPR size={12} />}>
              {tp.state[state]}
            </StatusPill>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
              <Avatar name={pr.author?.login ?? "?"} size="xs" />
              <span className="font-semibold text-ink">@{pr.author?.login ?? tp.unknownAuthor}</span>
              <span className="text-ink-3">· {createdAt}</span>
            </span>
            {details && (
              <span className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold tabular-nums">
                <span className="text-[var(--green-text)]">+{details.additions}</span>
                <span className="text-[var(--red-text)]">−{details.deletions}</span>
                <ChangeBar add={details.additions} del={details.deletions} />
                <span className="font-sans font-normal text-ink-3">{tp.filesChanged(details.files.length)}</span>
              </span>
            )}
          </>
        }
        headerActions={
          <>
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn--secondary ui-btn--sm ui-focus"
            >
              {tp.openOnGithub}
              <IconArrowUpRight size={13} />
            </a>
            {state !== "MERGED" && (
              <Button
                size="sm"
                variant="primary"
                icon={<IconPR size={14} />}
                onClick={() => setConfirmMerge(true)}
                loading={merging}
              >
                {merging ? tp.merging : tp.merge}
              </Button>
            )}
          </>
        }
        bodyClassName="flex min-h-0 flex-col !overflow-hidden"
      >
        {mergeError && (
          <div role="alert" className="ui-banner ui-banner--error mx-5 mt-4 shrink-0">
            <IconAlert size={15} className="mt-0.5 shrink-0" />
            <span>{mergeError}</span>
          </div>
        )}

        {/* Review progress strip */}
        {totalFiles > 0 && (
          <div className="flex shrink-0 items-center gap-4 border-b-2 border-line bg-panel px-5 py-2.5">
            <span className="t-label !text-[10px]">{tp.reviewProgress}</span>
            <span className="font-mono text-[13px] font-bold tabular-nums text-ink">
              {viewedCount}/{totalFiles}
            </span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-pill border-2 border-line bg-sunken">
              <div
                className="h-full border-r-2 border-line bg-green transition-[width] duration-300"
                style={{ width: `${(viewedCount / totalFiles) * 100}%`, borderRightWidth: viewedCount === 0 || allViewed ? 0 : 2 }}
              />
            </div>
            {allViewed && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[var(--green-text)]">
                <IconCheck size={13} />
                {tp.allReviewed}
              </span>
            )}
            {viewedCount > 0 && !allViewed && (
              <Button size="sm" variant="ghost" icon={<IconRetry size={12} />} onClick={() => setViewedFiles(new Set())}>
                {tp.reset}
              </Button>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* File list */}
          <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r-2 border-line bg-panel">
            <div className="flex items-center gap-2 border-b-2 border-dashed border-hair px-4 py-3">
              <IconFile size={14} className="text-ink-3" />
              <span className="t-label flex-1 !text-[10px]">{tp.changedFiles}</span>
              {details && <span className="font-mono text-[11px] font-semibold text-ink-3">{details.files.length}</span>}
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loading && !details && (
                <div className="flex flex-col gap-1.5 p-1">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="ui-hatch h-10 rounded-[8px] border-2 border-dashed border-hair" />
                  ))}
                </div>
              )}

              {detailsError && (
                <div className="ui-banner ui-banner--error m-1 !text-[12px]">
                  <IconAlert size={13} className="mt-0.5 shrink-0" />
                  <span>{detailsError}</span>
                </div>
              )}

              {details && details.files.map((file, idx) => {
                const isViewed = viewedFiles.has(file.filename);
                const { dir, base } = splitPath(file.filename);
                const letter = file.status === "added" ? "A" : file.status === "deleted" ? "D" : file.status === "renamed" ? "R" : "M";
                return (
                  <button
                    key={`${file.filename ?? "file"}-${idx}`}
                    type="button"
                    onClick={() => scrollToFile(file.filename)}
                    className="diff-filerow"
                    data-viewed={isViewed ? "true" : undefined}
                  >
                    <span className="diff-filerow__badge" data-letter={letter} aria-label={file.status}>
                      {isViewed ? <IconCheck size={10} /> : letter}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-mono text-[12px]">
                        <span className={clsx("font-semibold text-ink", isViewed && "line-through")}>{base}</span>
                      </span>
                      {dir && <span className="truncate font-mono text-[10.5px] text-ink-3">{dir}</span>}
                    </span>
                    <span className="flex shrink-0 flex-col items-end font-mono text-[10.5px] font-semibold tabular-nums leading-tight">
                      <span className="text-[var(--green-text)]">+{file.additions}</span>
                      <span className="text-[var(--red-text)]">−{file.deletions}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Diff */}
          <div ref={scrollContainerRef} className="relative min-w-0 flex-1 overflow-y-auto bg-paper">
            {diffLoading && (
              <div className="flex flex-col gap-2 p-5">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="ui-hatch h-4 rounded-[4px] border-[1.5px] border-dashed border-hair" style={{ width: `${55 + ((i * 37) % 45)}%` }} />
                ))}
              </div>
            )}

            {diffError && (
              <div role="alert" className="ui-banner ui-banner--error m-5">
                <IconAlert size={15} className="mt-0.5 shrink-0" />
                <span>{diffError}</span>
              </div>
            )}

            {!diffLoading && !diffError && files.length === 0 && diff !== null && (
              <div className="ui-hatch m-5 rounded-[14px] border-2 border-dashed border-line px-6 py-12 text-center text-[13px] text-ink-2">
                {tp.diffEmpty}
              </div>
            )}

            {!diffLoading && files.length > 0 && (
              <div className="flex flex-col gap-4 p-5">
                {files.map((file, idx) => (
                  <FileBlock
                    key={`${file.filename ?? "file"}-${idx}`}
                    file={file}
                    index={idx}
                    isViewed={viewedFiles.has(file.filename)}
                    isExpanded={!collapsedFiles.has(file.filename)}
                    onToggleViewed={() => toggleViewed(file.filename)}
                    onToggleExpanded={() => toggleExpanded(file.filename)}
                    registerRef={(el) => {
                      fileRefs.current[file.filename] = el;
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmMerge}
        title={tp.confirmMergeTitle}
        description={tp.confirmMergeDescription.replace("{n}", String(pr.number))}
        confirmLabel={tp.merge}
        cancelLabel={tp.cancel}
        variant="default"
        onConfirm={() => void handleMerge()}
        onCancel={() => setConfirmMerge(false)}
      />
    </>
  );
}
