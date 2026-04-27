"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { githubApi, type PRListItem, type PRFile, type PRDetails } from "@/lib/api";
import { PR_STATE_STYLES } from "@/lib/githubConstants";

export type PullRequest = PRListItem;

interface PRDetailDrawerProps {
  pr: PullRequest;
  projectId: string;
  onClose: () => void;
  onMerged: () => void;
}

const FILE_STATUS_STYLES: Record<string, string> = {
  added:    "bg-emerald-900/50 text-emerald-400 border border-emerald-800/50",
  modified: "bg-yellow-900/50 text-yellow-400 border border-yellow-800/50",
  deleted:  "bg-red-900/50 text-red-400 border border-red-800/50",
  renamed:  "bg-blue-900/50 text-blue-400 border border-blue-800/50",
};

const FILE_STATUS_LABELS: Record<string, string> = {
  added:    "Eklendi",
  modified: "Degistirildi",
  deleted:  "Silindi",
  renamed:  "Yeniden Adlandirildi",
};

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

// ─── Parser ───────────────────────────────────────────────────────────────────

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
    // File header
    if (line.startsWith("diff --git")) {
      flushRemoved();
      // Extract filename from "diff --git a/foo.ts b/foo.ts"
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      const filename = match ? match[1] : line;
      rows.push({ header: { content: line, type: "file-header", fileId: `diff-file-${slugify(filename)}` } });
      continue;
    }
    // Skip meta lines
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) {
      continue;
    }
    // Hunk header
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
    // Removed line
    if (line.startsWith("-")) {
      removedBuf.push({ lineNum: oldLine++, content: line.slice(1), type: "removed" });
      continue;
    }
    // Added line
    if (line.startsWith("+")) {
      const addedSide: SplitSide = { lineNum: newLine++, content: line.slice(1), type: "added" };
      if (removedBuf.length > 0) {
        rows.push({ left: removedBuf.shift(), right: addedSide });
      } else {
        rows.push({ left: { lineNum: 0, content: "", type: "empty" }, right: addedSide });
      }
      continue;
    }
    // Context line (starts with space or is empty)
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

// ─── Split diff renderer ──────────────────────────────────────────────────────

type SideVariant = "removed" | "added" | "empty" | "context";

function leftBg(type: SideVariant | undefined): string {
  if (type === "removed") return "bg-red-950/60";
  if (type === "empty")   return "bg-zinc-900/30";
  return "";
}

function rightBg(type: SideVariant | undefined): string {
  if (type === "added") return "bg-emerald-950/60";
  if (type === "empty") return "bg-zinc-900/30";
  return "";
}

function leftNumCls(type: SideVariant | undefined): string {
  if (type === "removed") return "bg-red-950/60 text-red-600";
  return "bg-zinc-950 text-zinc-600";
}

function rightNumCls(type: SideVariant | undefined): string {
  if (type === "added") return "bg-emerald-950/60 text-emerald-700";
  return "bg-zinc-950 text-zinc-600";
}

function leftContentCls(type: SideVariant | undefined): string {
  if (type === "removed") return "text-red-200";
  return "text-zinc-300";
}

function rightContentCls(type: SideVariant | undefined): string {
  if (type === "added") return "text-emerald-200";
  return "text-zinc-300";
}

function prefixCls(type: SideVariant | undefined): string {
  if (type === "removed") return "text-red-400";
  if (type === "added")   return "text-emerald-400";
  return "text-zinc-600";
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
          className="flex items-center gap-2 border-b border-t border-zinc-700/50 bg-zinc-900 px-4 py-2 text-[11px] font-semibold text-zinc-300"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-zinc-500">
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
          </svg>
          <span className="font-mono">{row.header.content.replace(/^diff --git a\/.+ b\//, "")}</span>
        </div>
      );
    }
    return (
      <div className="border-b border-zinc-800/60 bg-blue-950/20 px-4 py-0.5 font-mono text-[11px] text-blue-500/80">
        {row.header.content}
      </div>
    );
  }

  const left  = row.left;
  const right = row.right;
  const leftType  = left?.type  as SideVariant | undefined;
  const rightType = right?.type as SideVariant | undefined;

  return (
    <div className="flex min-w-0 border-b border-zinc-900/50 hover:bg-zinc-700/30">
      {/* Left side */}
      <div className="flex w-1/2 min-w-0 border-r border-zinc-800">
        <span
          className={`w-12 shrink-0 select-none border-r border-zinc-800/60 px-2 py-0.5 text-right font-mono text-[11px] ${leftNumCls(leftType)}`}
        >
          {left && leftType !== "empty" ? left.lineNum : ""}
        </span>
        <div className={`flex-1 overflow-x-auto px-3 py-0.5 ${leftBg(leftType)}`}>
          <span className={`whitespace-pre font-mono text-xs ${leftContentCls(leftType)}`}>
            <span className={`select-none ${prefixCls(leftType)}`}>{sidePrefix(leftType)}</span>
            {left && leftType !== "empty" ? left.content : ""}
          </span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex w-1/2 min-w-0">
        <span
          className={`w-12 shrink-0 select-none border-r border-zinc-800/60 px-2 py-0.5 text-right font-mono text-[11px] ${rightNumCls(rightType)}`}
        >
          {right && rightType !== "empty" ? right.lineNum : ""}
        </span>
        <div className={`flex-1 overflow-x-auto px-3 py-0.5 ${rightBg(rightType)}`}>
          <span className={`whitespace-pre font-mono text-xs ${rightContentCls(rightType)}`}>
            <span className={`select-none ${prefixCls(rightType)}`}>{sidePrefix(rightType)}</span>
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
      <p className="py-8 text-center font-mono text-xs text-zinc-600">Diff bulunamadi</p>
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

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch files details
  const fetchDetails = useCallback(async () => {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const data = await githubApi.getPRDetails(pr.number, projectId);
      setDetails(data);
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : "Bilinmeyen hata.");
    } finally {
      setDetailsLoading(false);
    }
  }, [pr.number, projectId]);

  // Fetch diff
  const fetchDiff = useCallback(async () => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const data = await githubApi.getPRDiff(pr.number, projectId);
      setDiff(data.diff ?? "");
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : "Bilinmeyen hata.");
    } finally {
      setDiffLoading(false);
    }
  }, [pr.number, projectId]);

  // Initial load — fetch both details and diff
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
      setMergeError(err instanceof Error ? err.message : "Merge sirasinda hata olustu.");
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="relative flex flex-col w-full max-w-[96rem] h-[90vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden"
          role="dialog"
          aria-modal="true"
        >
          {/* ── Header ── */}
          <header className="shrink-0 flex items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
            {/* Left: PR meta */}
            <div className="min-w-0 flex items-center gap-3 flex-1">
              <span className="font-mono text-sm text-zinc-500 shrink-0">#{pr.number}</span>
              <h2 className="font-semibold text-zinc-100 leading-tight truncate">{pr.title}</h2>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${stateStyle.cls}`}
              >
                {stateStyle.label}
              </span>
              {pr.repository && (
                <span className="hidden sm:inline text-[11px] text-zinc-600 shrink-0">
                  {pr.repository.nameWithOwner}
                </span>
              )}
            </div>

            {/* Right: actions */}
            <div className="shrink-0 flex items-center gap-2">
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                GitHub&apos;da Ac
              </a>
              {pr.state !== "MERGED" && (
                <button
                  type="button"
                  onClick={() => setConfirmMerge(true)}
                  disabled={merging}
                  className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {merging ? "Merging..." : "Merge"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Kapat"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>
          </header>

          {/* ── Merge error banner ── */}
          {mergeError && (
            <div className="shrink-0 bg-red-950/40 text-red-300 px-6 py-2 text-xs">
              {mergeError}
            </div>
          )}

          {/* ── Body (2-column) ── */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left: file list panel */}
            <aside className="w-64 shrink-0 border-r border-zinc-800 overflow-y-auto p-3 flex flex-col gap-2">
              {/* Panel title */}
              <div className="px-1 pb-1 border-b border-zinc-800">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">
                  Degisen Dosyalar
                </p>
                {details && (
                  <p className="mt-0.5 text-[11px] text-zinc-600">
                    <span className="text-emerald-400">+{details.additions}</span>
                    {" "}
                    <span className="text-red-400">-{details.deletions}</span>
                  </p>
                )}
              </div>

              {/* Skeleton */}
              {(loading && !details) && (
                <div className="flex flex-col gap-2 pt-1">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-800/60" />
                  ))}
                </div>
              )}

              {/* Error */}
              {detailsError && (
                <p className="text-xs text-red-400 px-1">{detailsError}</p>
              )}

              {/* File list */}
              {details && details.files.map((file, idx) => {
                const isActive = activeFile === file.filename;
                return (
                  <button
                    key={file.filename ?? idx}
                    type="button"
                    onClick={() => scrollToFile(file.filename)}
                    className={`w-full text-left rounded px-2 py-1.5 transition ${
                      isActive ? "bg-zinc-800" : "hover:bg-zinc-800/60"
                    }`}
                  >
                    <code className="block font-mono text-xs text-zinc-300 truncate">
                      {file.filename}
                    </code>
                    <span className="mt-0.5 flex gap-1.5 text-[11px]">
                      <span className="text-emerald-400">+{file.additions}</span>
                      <span className="text-red-400">-{file.deletions}</span>
                    </span>
                  </button>
                );
              })}
            </aside>

            {/* Right: diff panel */}
            <div ref={diffPanelRef} className="flex-1 overflow-hidden bg-zinc-950 flex flex-col">
              {/* Skeleton */}
              {diffLoading && (
                <div className="flex flex-col gap-3 p-6">
                  {[...Array(10)].map((_, i) => (
                    <div key={i} className="h-4 animate-pulse rounded bg-zinc-800/60" />
                  ))}
                </div>
              )}

              {/* Error */}
              {diffError && (
                <div className="m-6 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                  <span className="font-medium">Hata: </span>{diffError}
                </div>
              )}

              {/* Diff content */}
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
        title="PR merge edilsin mi?"
        description={`#${pr.number} numaralı PR merge edilecek.`}
        confirmLabel="Merge Et"
        cancelLabel="İptal"
        variant="default"
        onConfirm={() => void handleMerge()}
        onCancel={() => setConfirmMerge(false)}
      />
    </>
  );
}
