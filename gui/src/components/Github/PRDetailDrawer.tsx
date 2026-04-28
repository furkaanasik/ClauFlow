"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import clsx from "clsx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { githubApi, type PRListItem, type PRDetails } from "@/lib/api";
import { PR_STATE_STYLES } from "@/lib/githubConstants";

export type PullRequest = PRListItem;

interface PRDetailDrawerProps {
  pr: PullRequest;
  projectId: string;
  onClose: () => void;
  onMerged: () => void;
}

function slugify(s: string | undefined): string {
  return (s ?? "").replace(/[^a-zA-Z0-9]/g, "-");
}

// ─── Split-view diff types ────────────────────────────────────────────────────

interface SplitSide {
  lineNum: number;
  content: string;
  type: "context" | "removed" | "added" | "empty";
}

interface SplitRow {
  left?: SplitSide;
  right?: SplitSide;
  header?: { content: string; type: "file-header" | "hunk-header"; fileId?: string };
}

function parseSplitDiff(raw: string): SplitRow[] {
  const lines = raw.split("\n");
  const rows: SplitRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  const removedBuf: SplitSide[] = [];

  const flushRemoved = () => {
    while (removedBuf.length > 0) {
      rows.push({ left: removedBuf.shift(), right: { lineNum: 0, content: "", type: "empty" } });
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flushRemoved();
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      const filename = match ? match[1] : line;
      rows.push({ header: { content: line, type: "file-header", fileId: `diff-file-${slugify(filename)}` } });
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) {
      continue;
    }
    if (line.startsWith("@@")) {
      flushRemoved();
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      rows.push({ header: { content: line, type: "hunk-header" } });
      continue;
    }
    if (line.startsWith("-")) {
      removedBuf.push({ lineNum: oldLine++, content: line.slice(1), type: "removed" });
      continue;
    }
    if (line.startsWith("+")) {
      const addedSide: SplitSide = { lineNum: newLine++, content: line.slice(1), type: "added" };
      if (removedBuf.length > 0) {
        rows.push({ left: removedBuf.shift(), right: addedSide });
      } else {
        rows.push({ left: { lineNum: 0, content: "", type: "empty" }, right: addedSide });
      }
      continue;
    }
    if (line.startsWith(" ") || line === "") {
      flushRemoved();
      const content = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({
        left:  { lineNum: oldLine++, content, type: "context" },
        right: { lineNum: newLine++, content, type: "context" },
      });
      continue;
    }
  }

  flushRemoved();
  return rows;
}

type SideVariant = "removed" | "added" | "empty" | "context";

function leftBg(type: SideVariant | undefined): string {
  if (type === "removed") return "bg-[var(--status-error-ink)]";
  if (type === "empty")   return "bg-[var(--bg-sunken)]";
  return "";
}

function rightBg(type: SideVariant | undefined): string {
  if (type === "added") return "bg-[var(--accent-muted)]";
  if (type === "empty") return "bg-[var(--bg-sunken)]";
  return "";
}

function leftNumCls(type: SideVariant | undefined): string {
  if (type === "removed") return "bg-[var(--status-error-ink)] text-[var(--status-error)]";
  return "bg-[var(--bg-base)] text-[var(--text-faint)]";
}

function rightNumCls(type: SideVariant | undefined): string {
  if (type === "added") return "bg-[var(--accent-muted)] text-[var(--accent-primary)]";
  return "bg-[var(--bg-base)] text-[var(--text-faint)]";
}

function leftContentCls(type: SideVariant | undefined): string {
  if (type === "removed") return "text-[var(--status-error)]";
  return "text-[var(--text-secondary)]";
}

function rightContentCls(type: SideVariant | undefined): string {
  if (type === "added") return "text-[var(--accent-primary)]";
  return "text-[var(--text-secondary)]";
}

function prefixCls(type: SideVariant | undefined): string {
  if (type === "removed") return "text-[var(--status-error)]";
  if (type === "added")   return "text-[var(--accent-primary)]";
  return "text-[var(--text-faint)]";
}

function sidePrefix(type: SideVariant | undefined): string {
  if (type === "removed") return "-";
  if (type === "added")   return "+";
  return " ";
}

function SplitDiffRow({ row }: { row: SplitRow }) {
  if (row.header) {
    const isFile = row.header.type === "file-header";
    if (isFile) {
      return (
        <div
          id={row.header.fileId}
          className="flex items-center gap-2 border-y border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]"
        >
          <span className="text-[var(--text-faint)]">▸</span>
          <span className="font-mono normal-case tracking-normal text-[var(--text-primary)]">
            {row.header.content.replace(/^diff --git a\/.+ b\//, "")}
          </span>
        </div>
      );
    }
    return (
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
        {row.header.content}
      </div>
    );
  }

  const left  = row.left;
  const right = row.right;
  const leftType  = left?.type  as SideVariant | undefined;
  const rightType = right?.type as SideVariant | undefined;

  return (
    <div className="flex min-w-0 border-b border-[var(--border)]">
      <div className="flex w-1/2 min-w-0 border-r border-[var(--border)]">
        <span
          className={clsx(
            "w-12 shrink-0 select-none border-r border-[var(--border)] px-2 py-0.5 text-right font-mono text-[10px] tabular-nums",
            leftNumCls(leftType),
          )}
        >
          {left && leftType !== "empty" ? left.lineNum : ""}
        </span>
        <div className={clsx("flex-1 overflow-x-auto px-2 py-0.5", leftBg(leftType))}>
          <span className={clsx("whitespace-pre font-mono text-xs", leftContentCls(leftType))}>
            <span className={clsx("select-none", prefixCls(leftType))}>{sidePrefix(leftType)}</span>
            {left && leftType !== "empty" ? left.content : ""}
          </span>
        </div>
      </div>

      <div className="flex w-1/2 min-w-0">
        <span
          className={clsx(
            "w-12 shrink-0 select-none border-r border-[var(--border)] px-2 py-0.5 text-right font-mono text-[10px] tabular-nums",
            rightNumCls(rightType),
          )}
        >
          {right && rightType !== "empty" ? right.lineNum : ""}
        </span>
        <div className={clsx("flex-1 overflow-x-auto px-2 py-0.5", rightBg(rightType))}>
          <span className={clsx("whitespace-pre font-mono text-xs", rightContentCls(rightType))}>
            <span className={clsx("select-none", prefixCls(rightType))}>{sidePrefix(rightType)}</span>
            {right && rightType !== "empty" ? right.content : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function SplitDiffView({ diff, scrollToFileId }: { diff: string; scrollToFileId?: string | null }) {
  const rows = parseSplitDiff(diff);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20,
  });

  useEffect(() => {
    if (!scrollToFileId) return;
    const idx = rows.findIndex((r) => r.header?.fileId === scrollToFileId);
    if (idx !== -1) {
      virtualizer.scrollToIndex(idx, { align: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToFileId]);

  if (!diff.trim()) {
    return (
      <p className="t-quote py-12 text-center text-base text-[var(--text-muted)]">
        diff is empty.
      </p>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const row = rows[vItem.index]!;
          return (
            <div
              key={vItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              <SplitDiffRow row={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PRDetailDrawer({ pr, projectId, onClose, onMerged }: PRDetailDrawerProps) {
  const [details, setDetails]               = useState<PRDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError]     = useState<string | null>(null);

  const [diff, setDiff]               = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError]     = useState<string | null>(null);

  const [merging, setMerging]             = useState(false);
  const [mergeError, setMergeError]       = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge]   = useState(false);

  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [scrollToFileId, setScrollToFileId] = useState<string | null>(null);

  const diffPanelRef = useRef<HTMLDivElement>(null);

  const stateStyle = PR_STATE_STYLES[pr.state] ?? PR_STATE_STYLES["OPEN"];
  const loading = detailsLoading || diffLoading;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const handleMerge = async () => {
    setConfirmMerge(false);
    setMerging(true);
    setMergeError(null);
    try {
      await githubApi.mergePR(pr.number, projectId);
      onMerged();
      onClose();
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Merge failed.");
    } finally {
      setMerging(false);
    }
  };

  const scrollToFile = (filename: string) => {
    setActiveFile(filename);
    setScrollToFileId(`diff-file-${slugify(filename)}`);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="relative flex h-[92vh] w-full max-w-[96rem] flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-base)] shadow-2xl"
          role="dialog"
          aria-modal="true"
        >
          {/* ── Header ── */}
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="font-mono text-base font-semibold tabular-nums text-[var(--text-muted)]">
                #{pr.number}
              </span>
              <h2 className="t-display truncate text-2xl text-[var(--text-primary)]">
                {pr.title}
              </h2>
              <span
                className="inline-flex shrink-0 items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium capitalize"
                style={{ borderColor: stateStyle.ink, color: stateStyle.ink }}
              >
                <span className="h-1 w-1" style={{ background: stateStyle.ink }} />
                {stateStyle.label}
              </span>
              {pr.repository && (
                <span className="hidden shrink-0 font-mono text-[11px] text-[var(--text-faint)] sm:inline">
                  · {pr.repository.nameWithOwner}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost px-3 py-1.5 text-[12px] font-medium"
              >
                Open ↗
              </a>
              {pr.state !== "MERGED" && (
                <button
                  type="button"
                  onClick={() => setConfirmMerge(true)}
                  disabled={merging}
                  className="btn-ink px-4 py-1.5 text-[12px] font-medium disabled:opacity-50"
                >
                  {merging ? "Merging…" : "Merge"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="border border-[var(--border)] p-2 text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>
          </header>

          {mergeError && (
            <div className="shrink-0 border-b border-[var(--status-error)] bg-[var(--status-error-ink)] px-6 py-2 text-xs text-[var(--status-error)]">
              {mergeError}
            </div>
          )}

          {/* ── Body ── */}
          <div className="flex flex-1 overflow-hidden">
            {/* File list panel */}
            <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--bg-surface)]">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Changed files
                </p>
                {details && (
                  <p className="mt-2 flex items-center gap-3 font-mono text-[11px] tabular-nums">
                    <span className="text-[var(--accent-primary)]">+{details.additions}</span>
                    <span className="text-[var(--text-faint)]">·</span>
                    <span className="text-[var(--status-error)]">−{details.deletions}</span>
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {loading && !details && (
                  <div className="flex flex-col gap-1.5 p-2">
                    {[...Array(8)].map((_, i) => (
                      <div key={i} className="h-9 animate-pulse bg-[var(--bg-sunken)]" />
                    ))}
                  </div>
                )}

                {detailsError && (
                  <p className="px-2 py-3 text-xs text-[var(--status-error)]">{detailsError}</p>
                )}

                {details && details.files.map((file, idx) => {
                  const isActive = activeFile === file.filename;
                  return (
                    <button
                      key={file.filename ?? idx}
                      type="button"
                      onClick={() => scrollToFile(file.filename)}
                      className={clsx(
                        "group relative flex w-full flex-col gap-0.5 px-3 py-2 text-left transition",
                        isActive
                          ? "bg-[var(--bg-elevated)]"
                          : "hover:bg-[var(--bg-elevated)]",
                      )}
                    >
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 w-[2px] bg-[var(--accent-primary)]"
                        />
                      )}
                      <code className="block truncate font-mono text-[11px] text-[var(--text-primary)]">
                        {file.filename}
                      </code>
                      <span className="flex gap-2 font-mono text-[10px] tabular-nums">
                        <span className="text-[var(--accent-primary)]">+{file.additions}</span>
                        <span className="text-[var(--status-error)]">−{file.deletions}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Diff panel */}
            <div ref={diffPanelRef} className="flex flex-1 flex-col overflow-hidden bg-[var(--bg-base)]">
              {diffLoading && (
                <div className="flex flex-col gap-2 p-6">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="h-3 animate-pulse bg-[var(--bg-sunken)]" />
                  ))}
                </div>
              )}

              {diffError && (
                <div className="m-6 border border-[var(--status-error)] bg-[var(--status-error-ink)] px-4 py-3 text-sm text-[var(--status-error)]">
                  <span className="mr-2 font-mono uppercase tracking-widest">err·</span>
                  {diffError}
                </div>
              )}

              {diff !== null && !diffLoading && (
                <div className="flex-1 overflow-hidden">
                  <SplitDiffView diff={diff} scrollToFileId={scrollToFileId} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmMerge}
        title="merge this pull request?"
        description={`PR #${pr.number} will be merged into the base branch.`}
        confirmLabel="merge"
        cancelLabel="cancel"
        variant="default"
        onConfirm={() => void handleMerge()}
        onCancel={() => setConfirmMerge(false)}
      />
    </>
  );
}
