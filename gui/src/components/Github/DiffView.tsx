"use client";

import clsx from "clsx";
import { IconButton } from "@/components/ui/Button";
import { IconChevronRight } from "@/components/ui/icons";
import { slugify } from "@/lib/slug";
import { useTranslation } from "@/hooks/useTranslation";

/*
 * Split-view unified diff pieces shared by the PR drawer (GitHub diff) and the
 * task drawer's local changes tab (`git diff <base>...<branch>`).
 */

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

export interface FileDiff {
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
export function parseDiffByFile(raw: string): FileDiff[] {
  // A diff ends with "\n": drop the empty string after it, or it renders as a phantom context row.
  const lines = raw.replace(/\n$/, "").split("\n");
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

// ─── Diff rows ────────────────────────────────────────────────────────────────

type SideVariant = "removed" | "added" | "empty" | "context";

function sidePrefix(type: SideVariant | undefined): string {
  if (type === "removed") return "−";
  if (type === "added")   return "+";
  return " ";
}

function HunkHeader({ raw }: { raw: string }) {
  const tp = useTranslation().prs;
  const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
  const newStart = match?.[2];
  const context = match?.[3]?.trim();

  return (
    <div className="diff-hunk">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] font-semibold tabular-nums">
        <span aria-hidden>↳</span>
        {tp.line} {newStart ?? "?"}
      </span>
      {context && <span className="truncate font-mono text-[11px] text-ink-2">{context}</span>}
    </div>
  );
}

function Side({ side, edge }: { side?: SplitSide; edge?: boolean }) {
  const type = side?.type as SideVariant | undefined;
  const show = side && type !== "empty";
  return (
    <div className={clsx("diff-side", edge && "diff-side--edge")} data-type={type}>
      <span className="diff-num">{show ? side.lineNum : ""}</span>
      <div className="diff-code">
        <span className="diff-pre" aria-hidden>{sidePrefix(type)}</span>
        {show ? side.content : ""}
      </div>
    </div>
  );
}

function SplitDiffRow({ row }: { row: SplitRow }) {
  if (row.hunkHeader) return <HunkHeader raw={row.hunkHeader} />;
  return (
    <div className="diff-row">
      <Side side={row.left} edge />
      <Side side={row.right} />
    </div>
  );
}

export function splitPath(filename: string) {
  const i = filename.lastIndexOf("/");
  return i < 0 ? { dir: "", base: filename } : { dir: filename.slice(0, i + 1), base: filename.slice(i + 1) };
}

/** Proportional +/− bar (GitHub's five squares, Atölye style). */
export function ChangeBar({ add, del }: { add: number; del: number }) {
  const total = add + del;
  const greens = total === 0 ? 0 : Math.round((add / total) * 5);
  return (
    <span className="inline-flex gap-[2px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-[2px] border-[1.5px] border-line"
          style={{ background: total === 0 ? "var(--sunken)" : i < greens ? "var(--green)" : "var(--red)" }}
        />
      ))}
    </span>
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
  /** No "viewed" checkbox (bakim #6: a stash file is not reviewed). */
  hideViewed?: boolean;
}

export function FileBlock({
  file,
  index,
  isViewed,
  isExpanded,
  onToggleViewed,
  onToggleExpanded,
  registerRef,
  hideViewed = false,
}: FileBlockProps) {
  const tp = useTranslation().prs;
  const { dir, base } = splitPath(file.filename);
  return (
    <div ref={registerRef} id={file.fileId} className="diff-file" data-viewed={isViewed ? "true" : undefined}>
      <header className="diff-file__head">
        <IconButton
          label={isExpanded ? tp.collapse : tp.expand}
          size="sm"
          variant="ghost"
          onClick={onToggleExpanded}
          className="!h-7 !w-7"
        >
          <IconChevronRight size={13} className={clsx("transition-transform", isExpanded && "rotate-90")} />
        </IconButton>
        <span className="font-mono text-[10.5px] font-semibold tabular-nums text-ink-3">
          {String(index + 1).padStart(2, "0")}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={file.filename}>
          <span className="text-ink-3">{dir}</span>
          <span className={clsx("font-bold text-ink", isViewed && "line-through decoration-2")}>{base}</span>
        </code>
        <span className="hidden shrink-0 items-center gap-2 font-mono text-[11.5px] font-semibold tabular-nums sm:inline-flex">
          <span className="text-[var(--green-text)]">+{file.additions}</span>
          <span className="text-[var(--red-text)]">−{file.deletions}</span>
          <ChangeBar add={file.additions} del={file.deletions} />
        </span>
        {!hideViewed && (
          <label className="diff-viewed">
            <input type="checkbox" className="ui-check" checked={isViewed} onChange={onToggleViewed} />
            {isViewed ? tp.viewed : tp.markViewed}
          </label>
        )}
      </header>

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
