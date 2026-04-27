"use client";

import { useState, useMemo } from "react";
import clsx from "clsx";
import type { AgentText, ToolCall } from "@/types";

// ─── Icon SVGs (inline, no external deps) ────────────────────────────────────

function IconRead() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s1-1 4-1 5 2 7 2V4C10 4 8 2 5 2S1 4 1 4z"/>
      <line x1="8" y1="3" x2="8" y2="13"/>
    </svg>
  );
}

function IconWrite() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 2a1.4 1.4 0 0 1 2 2l-9 9-3 1 1-3z"/>
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 14h12M9.5 2.5l3 3-7 7H2.5v-3z"/>
    </svg>
  );
}

function IconBash() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="2" width="14" height="12" rx="2"/>
      <polyline points="4,6 7,8 4,10"/>
      <line x1="8" y1="10" x2="12" y2="10"/>
    </svg>
  );
}

function IconGrep() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5"/>
      <line x1="10" y1="10" x2="14" y2="14"/>
    </svg>
  );
}

function IconGlob() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 4h12v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>
      <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>
    </svg>
  );
}

function IconTask() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8l2 2 4-4"/>
      <path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>
    </svg>
  );
}

function IconDefault() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="8" r="6"/>
      <line x1="8" y1="5" x2="8" y2="8"/>
      <line x1="8" y1="11" x2="8" y2="11"/>
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={clsx("shrink-0 transition-transform duration-150", open && "rotate-90")}
    >
      <polyline points="6,4 10,8 6,12" />
    </svg>
  );
}

// ─── Tool config map ─────────────────────────────────────────────────────────

interface ToolConfig {
  icon: React.ReactNode;
  color: string;      // text + bg for the icon pill
  label: string;
}

function getToolConfig(toolName: string): ToolConfig {
  const t = toolName.toLowerCase();

  if (t === "read")
    return { icon: <IconRead />, color: "text-teal-400 bg-teal-900/40",  label: "Read" };
  if (t === "write")
    return { icon: <IconWrite />, color: "text-green-400 bg-green-900/40", label: "Write" };
  if (t === "edit")
    return { icon: <IconEdit />, color: "text-blue-400 bg-blue-900/40",  label: "Edit" };
  if (t === "bash" || t === "shell" || t === "run")
    return { icon: <IconBash />, color: "text-orange-400 bg-orange-900/40", label: "Bash" };
  if (t === "grep" || t === "search")
    return { icon: <IconGrep />, color: "text-purple-400 bg-purple-900/40", label: "Grep" };
  if (t === "glob" || t === "find" || t === "ls")
    return { icon: <IconGlob />, color: "text-zinc-300 bg-zinc-700/60", label: "Glob" };
  if (t === "task" || t === "todowrite" || t.includes("agent"))
    return { icon: <IconTask />, color: "text-indigo-400 bg-indigo-900/40", label: toolName };

  return { icon: <IconDefault />, color: "text-zinc-400 bg-zinc-800", label: toolName };
}

// ─── Duration formatter ──────────────────────────────────────────────────────

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function totalDuration(calls: ToolCall[]): number {
  return calls.reduce((acc, c) => acc + (c.durationMs ?? 0), 0);
}

// ─── Arg/result summariser ───────────────────────────────────────────────────

function argsSummary(args?: Record<string, unknown>): string {
  if (!args) return "";
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  // Show first meaningful string value (file_path, command, pattern…)
  const priority = ["file_path", "path", "command", "pattern", "query", "description"];
  for (const key of priority) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) {
      const truncated = val.length > 60 ? val.slice(0, 57) + "…" : val;
      return truncated;
    }
  }
  // Fallback: first string value
  for (const [, val] of entries) {
    if (typeof val === "string" && val.length > 0) {
      return val.length > 60 ? val.slice(0, 57) + "…" : val;
    }
  }
  return "";
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ToolCall["status"] }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-yellow-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
        running
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-400">
        <span className="text-red-400">✕</span>
        error
      </span>
    );
  }
  // done
  return (
    <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
      <span className="text-emerald-500">✓</span>
    </span>
  );
}

// ─── Agent text block ─────────────────────────────────────────────────────────

function AgentTextBlock({ item }: { item: AgentText }) {
  return (
    <div
      className="rounded-md px-2.5 py-1.5 text-[11px] italic leading-relaxed"
      style={{
        borderLeft: "2px solid color-mix(in oklab, var(--accent-primary) 60%, transparent)",
        background: "color-mix(in oklab, var(--accent-primary) 6%, transparent)",
        color: "color-mix(in oklab, var(--text-primary) 80%, var(--accent-primary))",
        whiteSpace: "pre-wrap",
      }}
    >
      {item.text}
    </div>
  );
}

// ─── Single tool call card ───────────────────────────────────────────────────

function ToolCallCard({ call, compact }: { call: ToolCall; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const cfg = getToolConfig(call.toolName);
  const summary = argsSummary(call.args);
  const duration = formatDuration(call.durationMs);
  const hasArgs = call.args != null && typeof call.args === "object" && Object.keys(call.args).length > 0;
  const hasDetail = hasArgs || !!call.result;

  return (
    <div
      className="rounded-lg border transition-colors"
      style={{
        background: "var(--bg-elevated)",
        borderColor: open ? "var(--accent-primary)" : "var(--border)",
      }}
    >
      {/* Card header — always visible */}
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={clsx(
          "flex w-full items-center gap-2 px-2.5 text-left",
          compact ? "py-1.5" : "py-2",
          !hasDetail && "cursor-default",
        )}
      >
        {/* Tool icon pill */}
        <span className={clsx("flex items-center justify-center rounded p-1 shrink-0", cfg.color)}>
          {cfg.icon}
        </span>

        {/* Tool name */}
        <span className="shrink-0 text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {cfg.label}
        </span>

        {/* Args summary */}
        {summary && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {summary}
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <StatusBadge status={call.status} />
          {duration && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{duration}</span>
          )}
          {hasDetail && (
            <span style={{ color: "var(--text-muted)" }}>
              <IconChevron open={open} />
            </span>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {open && hasDetail && (
        <div className="border-t px-2.5 pb-2.5 pt-2" style={{ borderColor: "var(--border)" }}>
          {call.args && (
            <div className="mb-2">
              <p
                className="mb-1 text-[9px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                Args
              </p>
              <pre
                className="max-h-36 overflow-auto rounded-md p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap"
                style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
              >
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          )}
          {call.result && (
            <div>
              <p
                className="mb-1 text-[9px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                Result
              </p>
              <pre
                className="max-h-48 overflow-auto rounded-md p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap"
                style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
              >
                {call.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Summary pill ─────────────────────────────────────────────────────────────

function SummaryPill({
  calls,
  isAgentRunning,
  thinkingMessage,
}: {
  calls: ToolCall[];
  isAgentRunning?: boolean;
  thinkingMessage?: string;
}) {
  const total = totalDuration(calls);
  const doneCount = calls.filter((c) => c.status === "done").length;
  const runningCount = calls.filter((c) => c.status === "running").length;
  const showThinking = !!isAgentRunning && runningCount === 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className="rounded-full border px-2.5 py-0.5 text-[10px] font-medium"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border)",
          color: "var(--text-muted)",
        }}
      >
        {calls.length} tool call{calls.length !== 1 ? "s" : ""}
        {total > 0 && ` · ${formatDuration(total)}`}
      </span>
      {runningCount > 0 && (
        <span className="flex items-center gap-1 rounded-full border border-yellow-800/60 bg-yellow-900/20 px-2.5 py-0.5 text-[10px] font-medium text-yellow-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
          {runningCount} running
        </span>
      )}
      {showThinking && (
        <span
          className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium"
          style={{
            background: "color-mix(in oklab, var(--accent-primary) 15%, transparent)",
            borderColor: "color-mix(in oklab, var(--accent-primary) 50%, transparent)",
            color: "var(--accent-primary)",
          }}
        >
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ background: "var(--accent-primary)" }}
          />
          {thinkingMessage ?? "Agent thinking"}…
        </span>
      )}
      {doneCount > 0 && runningCount === 0 && !showThinking && (
        <span className="rounded-full border border-emerald-800/40 bg-emerald-900/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-500">
          ✓ {doneCount} done
        </span>
      )}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

type TimelineItem =
  | { kind: "tool_call"; data: ToolCall; sortKey: string }
  | { kind: "text"; data: AgentText; sortKey: string };

interface ToolCallTimelineProps {
  toolCalls: ToolCall[];
  agentTexts?: AgentText[];
  compact?: boolean;
  emptyMessage?: string;
  isAgentRunning?: boolean;
  thinkingMessage?: string;
}

export function ToolCallTimeline({
  toolCalls,
  agentTexts = [],
  compact,
  emptyMessage,
  isAgentRunning,
  thinkingMessage,
}: ToolCallTimelineProps) {
  // Build a unified, chronologically sorted list of tool_calls and agent texts
  const items = useMemo<TimelineItem[]>(() => {
    const tcItems: TimelineItem[] = toolCalls.map((tc) => ({
      kind: "tool_call",
      data: tc,
      sortKey: tc.startedAt ?? tc.createdAt ?? "",
    }));
    const textItems: TimelineItem[] = agentTexts.map((at) => ({
      kind: "text",
      data: at,
      sortKey: at.createdAt,
    }));
    return [...tcItems, ...textItems].sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey),
    );
  }, [toolCalls, agentTexts]);

  const sortedToolCalls = useMemo(
    () => toolCalls.slice().sort((a, b) => {
      if (a.startedAt && b.startedAt) return a.startedAt.localeCompare(b.startedAt);
      return 0;
    }),
    [toolCalls],
  );

  const hasRunning = sortedToolCalls.some((c) => c.status === "running");
  const showThinkingCard = !!isAgentRunning && !hasRunning;
  const isEmpty = items.length === 0;

  if (isEmpty) {
    if (showThinkingCard) {
      return (
        <div
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-8 text-xs"
          style={{
            borderColor: "color-mix(in oklab, var(--accent-primary) 50%, transparent)",
            background: "color-mix(in oklab, var(--accent-primary) 10%, transparent)",
            color: "var(--accent-primary)",
          }}
        >
          <span
            className="h-2 w-2 animate-pulse rounded-full"
            style={{ background: "var(--accent-primary)" }}
          />
          {thinkingMessage ?? "Agent thinking"}…
        </div>
      );
    }
    return (
      <div
        className="flex flex-1 items-center justify-center rounded-xl border border-dashed py-8 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        {emptyMessage ?? "Tool calls will appear here during execution"}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Summary pill — only tool call counts */}
      <SummaryPill calls={sortedToolCalls} isAgentRunning={isAgentRunning} thinkingMessage={thinkingMessage} />

      {/* Interleaved list: tool calls + agent texts, chronological */}
      <div className="flex flex-col gap-1">
        {items.map((item) =>
          item.kind === "tool_call" ? (
            <ToolCallCard key={`tc-${item.data.id}`} call={item.data} compact={compact} />
          ) : (
            <AgentTextBlock key={`at-${item.data.id}`} item={item.data} />
          ),
        )}
      </div>

      {/* Thinking indicator card — son tool call done ama agent hâlâ çalışıyor */}
      {showThinkingCard && (
        <div
          className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]"
          style={{
            borderColor: "color-mix(in oklab, var(--accent-primary) 50%, transparent)",
            background: "color-mix(in oklab, var(--accent-primary) 10%, transparent)",
            color: "var(--accent-primary)",
          }}
        >
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ background: "var(--accent-primary)" }}
          />
          {thinkingMessage ?? "Agent thinking"}…
        </div>
      )}
    </div>
  );
}
