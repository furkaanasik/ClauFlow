"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import clsx from "clsx";
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
  hunkHeader?: string;
}

interface FileDiff {
  filename: string;
  fileId: string;
  rows: SplitRow[];
  additions: number;
  deletions: number;
}

/**
 * Parse a unified diff into a list of files. Each file has its own rows
 * (split-view, hunk headers inline). The "diff --git" header is not included
 * in rows — it's surfaced as the file's name on the surrounding component.
 */
function parseDiffByFile(raw: string): FileDiff[] {
  const lines = raw.split("\n");
  const files: FileDiff[] = [];

  let current: FileDiff | null = null;
  let oldLine = 0;
  let newLine = 0;
  const removedBuf: SplitSide[] = [];

  const flushRemoved = () => {
    if (!current) return;
    while (removedBuf.length > 0) {
      current.rows.push({
        left: removedBuf.shift(),
        right: { lineNum: 0, content: "", type: "empty" },
      });
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flushRemoved();
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      const filename = match ? match[1] : "unknown";
      current = {
        filename,
        fileId: `diff-file-${slugify(filename)}`,
        rows: [],
        additions: 0,
        deletions: 0,
      };
      files.push(current);
      oldLine = 0;
      newLine = 0;
      continue;
    }
    if (
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to")
    ) {
      continue;
    }
    if (!current) continue;

    if (line.startsWith("@@")) {
      flushRemoved();
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      current.rows.push({ hunkHeader: line });
      continue;
    }
    if (line.startsWith("-")) {
      removedBuf.push({ lineNum: oldLine++, content: line.slice(1), type: "removed" });
      current.deletions++;
      continue;
    }
    if (line.startsWith("+")) {
      current.additions++;
      const addedSide: SplitSide = { lineNum: newLine++, content: line.slice(1), type: "added" };
      if (removedBuf.length > 0) {
        current.rows.push({ left: removedBuf.shift(), right: addedSide });
      } else {
        current.rows.push({ left: { lineNum: 0, content: "", type: "empty" }, right: addedSide });
      }
      continue;
    }
    if (line.startsWith(" ") || line === "") {
      flushRemoved();
      const content = line.startsWith(" ") ? line.slice(1) : line;
      current.rows.push({
        left: { lineNum: oldLine++, content, type: "context" },
        right: { lineNum: newLine++, content, type: "context" },
      });
      continue;
    }
  }
  flushRemoved();
  return files;
}

// ─── Per-row styling helpers ──────────────────────────────────────────────────

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
  if (row.hunkHeader) {
    return (
      <div className="border-y border-[var(--border)] bg-[var(--bg-surface)] px-3 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
        {row.hunkHeader}
      </div>
    );
  }

  const left = row.left;
  const right = row.right;
  const leftType = left?.type as SideVariant | undefined;
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

// ─── Per-file block ──────────────────────────────────────────────────────────

interface FileBlockProps {
  file: FileDiff;
  index: number;
  isViewed: boolean;
  isExpanded: boolean;
  onToggleViewed: () => void;
  onToggleExpanded: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

function FileBlock({
  file,
  index,
  isViewed,
  isExpanded,
  onToggleViewed,
  onToggleExpanded,
  registerRef,
}: FileBlockProps) {
  return (
    <div
      ref={registerRef}
      id={file.fileId}
      className={clsx(
        "border border-[var(--border)] bg-[var(--bg-base)] transition-colors",
        isViewed && "border-[var(--accent-primary)]/40 bg-[var(--bg-sunken)]",
      )}
    >
      {/* sticky file header */}
      <header
        className={clsx(
          "sticky top-0 z-[1] flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2",
          isViewed && "bg-[var(--bg-sunken)]",
        )}
      >
        {/* expand/collapse toggle */}
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={clsx("transition-transform", isExpanded ? "rotate-90" : "rotate-0")}
            aria-hidden
          >
            <polyline points="6,4 10,8 6,12" />
          </svg>
        </button>

        {/* index */}
        <span className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
          {String(index + 1).padStart(2, "0")}
        </span>

        {/* filename */}
        <code
          className={clsx(
            "min-w-0 flex-1 truncate font-mono text-[12px]",
            isViewed ? "text-[var(--text-muted)] line-through opacity-70" : "text-[var(--text-primary)]",
          )}
          title={file.filename}
        >
          {file.filename}
        </code>

        {/* +/- counts */}
        <span className="hidden shrink-0 gap-2 font-mono text-[11px] tabular-nums sm:flex">
          <span className="text-[var(--accent-primary)]">+{file.additions}</span>
          <span className="text-[var(--status-error)]">−{file.deletions}</span>
        </span>

        {/* Viewed toggle */}
        <button
          type="button"
          onClick={onToggleViewed}
          className={clsx(
            "inline-flex shrink-0 items-center gap-2 border px-2.5 py-1 text-[11px] font-medium transition",
            isViewed
              ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-ink)]"
              : "border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]",
          )}
          aria-pressed={isViewed}
        >
          <span
            className={clsx(
              "flex h-3 w-3 shrink-0 items-center justify-center border",
              isViewed
                ? "border-[var(--accent-ink)] bg-[var(--accent-ink)]"
                : "border-[var(--border-strong)]",
            )}
          >
            {isViewed && (
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="2 6 5 9 10 3" />
              </svg>
            )}
          </span>
          {isViewed ? "Viewed" : "Mark viewed"}
        </button>
      </header>

      {/* body */}
      {isExpanded && (
        <div className="overflow-x-auto">
          {file.rows.map((row, i) => (
            <SplitDiffRow key={i} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export function PRDetailDrawer({ pr, projectId, onClose, onMerged }: PRDetailDrawerProps) {
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

  const stateStyle = PR_STATE_STYLES[pr.state] ?? PR_STATE_STYLES["OPEN"];
  const loading = detailsLoading || diffLoading;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
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
      setMergeError(err instanceof Error ? err.message : "Merge failed.");
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
          {/* Header */}
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

          {/* Review progress strip */}
          {totalFiles > 0 && (
            <div className="flex shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--text-muted)]">Review progress</span>
                <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {viewedCount}/{totalFiles}
                </span>
              </div>
              <div className="relative h-1 flex-1 overflow-hidden bg-[var(--bg-sunken)]">
                <div
                  className="h-full bg-[var(--accent-primary)] transition-all duration-300"
                  style={{ width: `${(viewedCount / totalFiles) * 100}%` }}
                />
              </div>
              {allViewed && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent-primary)]">
                  <span className="h-1.5 w-1.5 bg-[var(--accent-primary)]" />
                  All files reviewed
                </span>
              )}
              {viewedCount > 0 && !allViewed && (
                <button
                  type="button"
                  onClick={() => setViewedFiles(new Set())}
                  className="text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
                >
                  Reset
                </button>
              )}
            </div>
          )}

          {/* Body */}
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

                {details && details.files.map((file) => {
                  const isViewed = viewedFiles.has(file.filename);
                  return (
                    <button
                      key={file.filename}
                      type="button"
                      onClick={() => scrollToFile(file.filename)}
                      className="group relative flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-[var(--bg-elevated)]"
                    >
                      <span
                        className={clsx(
                          "mt-1 flex h-3 w-3 shrink-0 items-center justify-center border",
                          isViewed
                            ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
                            : "border-[var(--border-strong)]",
                        )}
                        aria-hidden
                      >
                        {isViewed && (
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="var(--accent-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="2 6 5 9 10 3" />
                          </svg>
                        )}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <code
                          className={clsx(
                            "block truncate font-mono text-[11px]",
                            isViewed
                              ? "text-[var(--text-muted)] line-through opacity-70"
                              : "text-[var(--text-primary)]",
                          )}
                        >
                          {file.filename}
                        </code>
                        <span className="flex gap-2 font-mono text-[10px] tabular-nums">
                          <span className="text-[var(--accent-primary)]">+{file.additions}</span>
                          <span className="text-[var(--status-error)]">−{file.deletions}</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Diff panel */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto bg-[var(--bg-base)]">
              {diffLoading && (
                <div className="flex flex-col gap-2 p-6">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="h-3 animate-pulse bg-[var(--bg-sunken)]" />
                  ))}
                </div>
              )}

              {diffError && (
                <div className="m-6 border border-[var(--status-error)] bg-[var(--status-error-ink)] px-4 py-3 text-sm text-[var(--status-error)]">
                  {diffError}
                </div>
              )}

              {!diffLoading && !diffError && files.length === 0 && diff !== null && (
                <p className="t-quote py-12 text-center text-base text-[var(--text-muted)]">
                  Diff is empty.
                </p>
              )}

              {!diffLoading && files.length > 0 && (
                <div className="flex flex-col gap-3 p-4">
                  {files.map((file, idx) => (
                    <FileBlock
                      key={file.filename}
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
