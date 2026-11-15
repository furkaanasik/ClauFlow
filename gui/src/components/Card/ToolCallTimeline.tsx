"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { StatusPill } from "@/components/ui/Pills";
import {
  IconBolt,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconPencil,
  IconRobot,
  IconSearch,
  IconTerminal,
} from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import type { AgentText, ToolCall } from "@/types";

// ─── Tool families: one colour per kind of work ──────────────────────────────

type Family = "look" | "make" | "run" | "delegate" | "other";

const FAMILY: Record<Family, { fill: string; on: string }> = {
  look: { fill: "var(--mustard)", on: "var(--on-mustard)" },
  make: { fill: "var(--cobalt)", on: "var(--on-cobalt)" },
  run: { fill: "var(--orange)", on: "var(--on-orange)" },
  delegate: { fill: "var(--ink)", on: "var(--on-ink)" },
  other: { fill: "var(--panel)", on: "var(--ink)" },
};

interface ToolConfig {
  icon: ReactNode;
  family: Family;
  label: string;
}

function getToolConfig(toolName: string): ToolConfig {
  const t = toolName.toLowerCase();
  if (t === "read") return { icon: <IconFile size={14} />, family: "look", label: "Read" };
  if (t === "grep" || t === "search") return { icon: <IconSearch size={14} />, family: "look", label: "Grep" };
  if (t === "glob" || t === "find" || t === "ls") return { icon: <IconFolder size={14} />, family: "look", label: "Glob" };
  if (t === "write") return { icon: <IconPencil size={14} />, family: "make", label: "Write" };
  if (t === "edit" || t === "multiedit") return { icon: <IconPencil size={14} />, family: "make", label: "Edit" };
  if (t === "bash" || t === "shell" || t === "run") return { icon: <IconTerminal size={14} />, family: "run", label: "Bash" };
  if (t === "task" || t === "todowrite" || t.includes("agent"))
    return { icon: <IconRobot size={14} />, family: "delegate", label: toolName };
  return { icon: <IconBolt size={14} />, family: "other", label: toolName };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function clock(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

function argsSummary(args?: Record<string, unknown>): string {
  if (!args) return "";
  const priority = ["file_path", "path", "command", "pattern", "query", "description"];
  for (const key of priority) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) return val.length > 90 ? val.slice(0, 87) + "…" : val;
  }
  for (const val of Object.values(args)) {
    if (typeof val === "string" && val.length > 0) return val.length > 90 ? val.slice(0, 87) + "…" : val;
  }
  return "";
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function CallStatus({ status }: { status: ToolCall["status"] }) {
  const t = useTranslation().toolTimeline;
  if (status === "running")
    return (
      <StatusPill status="doing" live className="!h-5 !px-2 !text-[10.5px]">
        {t.statusRun}
      </StatusPill>
    );
  if (status === "error")
    return (
      <StatusPill status="error" variant="solid" className="!h-5 !px-2 !text-[10.5px]">
        {t.statusErr}
      </StatusPill>
    );
  return (
    <StatusPill status="done" className="!h-5 !px-2 !text-[10.5px]">
      {t.statusOk}
    </StatusPill>
  );
}

function ToolCallRow({ call, compact }: { call: ToolCall; compact?: boolean }) {
  const t = useTranslation().toolTimeline;
  const [open, setOpen] = useState(false);
  const cfg = getToolConfig(call.toolName);
  const fam = FAMILY[cfg.family];
  const summary = argsSummary(call.args);
  const duration = formatDuration(call.durationMs);
  const hasArgs = call.args != null && typeof call.args === "object" && Object.keys(call.args).length > 0;
  const hasDetail = hasArgs || !!call.result;

  const head = (
    <>
      <span className="tl__tool">{cfg.label}</span>
      {summary ? <span className="tl__sum">{summary}</span> : <span className="flex-1" />}
      <CallStatus status={call.status} />
      {duration && <span className="tl__dur">{duration}</span>}
      {hasDetail && (
        <IconChevronRight
          size={13}
          className={clsx("shrink-0 text-ink-3 transition-transform duration-150", open && "rotate-90")}
        />
      )}
    </>
  );

  return (
    <li className="tl__row">
      <span className="tl__time">{clock(call.startedAt ?? call.createdAt)}</span>
      <span
        className="tl__node"
        data-status={call.status}
        style={{ "--tl-node": fam.fill, "--tl-on": fam.on } as CSSProperties}
        aria-hidden
      >
        {cfg.icon}
      </span>
      <div className="tl__card" data-open={open} data-status={call.status}>
        {hasDetail ? (
          <button
            type="button"
            className={clsx("tl__head", compact && "!min-h-[2rem]")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {head}
          </button>
        ) : (
          <div className={clsx("tl__head", compact && "!min-h-[2rem]")}>{head}</div>
        )}
        {open && hasDetail && (
          <div className="tl__body">
            {hasArgs && (
              <div>
                <p className="t-label mb-1.5">{t.args}</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border-2 border-line bg-sunken p-2.5 font-mono text-[11px] leading-relaxed text-ink">
                  {JSON.stringify(call.args, null, 2)}
                </pre>
              </div>
            )}
            {call.result && (
              <div>
                <p className="t-label mb-1.5">{t.result}</p>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[8px] border-2 border-line bg-sunken p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
                  {call.result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function AgentTextRow({ item }: { item: AgentText }) {
  const t = useTranslation().toolTimeline;
  return (
    <li className="tl__row">
      <span className="tl__time">{clock(item.createdAt)}</span>
      <span className="tl__node tl__node--text" aria-hidden>
        <IconRobot size={14} />
      </span>
      <div className="min-w-0">
        <span className="sr-only">{t.agent}: </span>
        <p className="tl__say">{item.text}</p>
      </div>
    </li>
  );
}

function ThinkingRow({ label }: { label: string }) {
  return (
    <li className="tl__row">
      <span className="tl__time" />
      <span className="tl__node tl__node--text" data-status="running" aria-hidden>
        <IconRobot size={14} />
      </span>
      <div className="flex min-h-[2rem] items-center gap-2 font-mono text-[12px] font-semibold text-[var(--orange-text)]">
        <span className="flex gap-1" aria-hidden>
          <span className="animate-dot-1 h-1.5 w-1.5 rounded-full bg-orange" />
          <span className="animate-dot-2 h-1.5 w-1.5 rounded-full bg-orange" />
          <span className="animate-dot-3 h-1.5 w-1.5 rounded-full bg-orange" />
        </span>
        {label}…
      </div>
    </li>
  );
}

function Summary({
  calls,
  isAgentRunning,
  thinkingMessage,
}: {
  calls: ToolCall[];
  isAgentRunning?: boolean;
  thinkingMessage: string;
}) {
  const t = useTranslation().toolTimeline;
  const total = calls.reduce((acc, c) => acc + (c.durationMs ?? 0), 0);
  const done = calls.filter((c) => c.status === "done").length;
  const running = calls.filter((c) => c.status === "running").length;
  const failed = calls.filter((c) => c.status === "error").length;
  const thinking = !!isAgentRunning && running === 0;

  const mix = useMemo(() => {
    const m = new Map<Family, number>();
    for (const c of calls) {
      const f = getToolConfig(c.toolName).family;
      m.set(f, (m.get(f) ?? 0) + 1);
    }
    return (["look", "make", "run", "delegate", "other"] as Family[])
      .map((f) => ({ f, n: m.get(f) ?? 0 }))
      .filter((x) => x.n > 0);
  }, [calls]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border-2 border-line bg-panel px-3 py-2.5 shadow-hard">
      <span className="font-mono text-[13px] font-bold text-ink">{t.calls(calls.length)}</span>
      {total > 0 && <span className="font-mono text-[12px] text-ink-3">· {formatDuration(total)}</span>}
      <span className="flex flex-wrap items-center gap-1.5">
        {running > 0 && (
          <StatusPill status="doing" live>
            {t.running(running)}
          </StatusPill>
        )}
        {thinking && (
          <StatusPill status="doing" live>
            {thinkingMessage}…
          </StatusPill>
        )}
        {failed > 0 && <StatusPill status="error">{t.errors(failed)}</StatusPill>}
        {done > 0 && running === 0 && !thinking && <StatusPill status="done">{t.done(done)}</StatusPill>}
      </span>
      {mix.length > 0 && (
        <div className="ml-auto flex items-center gap-2" title={t.mix}>
          <span className="t-label hidden sm:inline">{t.mix}</span>
          <span
            className="flex h-3 w-36 overflow-hidden rounded-pill border-2 border-line bg-sunken"
            role="img"
            aria-label={`${t.mix}: ${mix.map((x) => `${x.f} ${x.n}`).join(", ")}`}
          >
            {mix.map((x, i) => (
              <span
                key={x.f}
                style={{
                  flex: x.n,
                  background: FAMILY[x.f].fill,
                  borderLeft: i > 0 ? "2px solid var(--line)" : undefined,
                }}
              />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

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

/**
 * Printed log timeline: clock gutter, dashed ink rail, a coloured node per
 * tool family (look / make / run / delegate) and expandable call cards.
 * Agent narration sits on the same rail as speech bubbles.
 */
export function ToolCallTimeline({
  toolCalls,
  agentTexts = [],
  compact,
  emptyMessage,
  isAgentRunning,
  thinkingMessage,
}: ToolCallTimelineProps) {
  const td = useTranslation().taskDetail;
  const thinkingLabel = thinkingMessage ?? td.toolThinking;

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
    return [...tcItems, ...textItems].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [toolCalls, agentTexts]);

  const hasRunning = toolCalls.some((c) => c.status === "running");
  const showThinking = !!isAgentRunning && !hasRunning;

  if (items.length === 0) {
    if (showThinking) {
      return (
        <ol className="tl rounded-[12px] border-2 border-dashed border-line bg-panel px-3 py-4">
          <ThinkingRow label={thinkingLabel} />
        </ol>
      );
    }
    return (
      <div className="ui-hatch flex flex-1 flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-12 text-center">
        <span
          aria-hidden
          className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-panel text-ink-2 shadow-hard"
        >
          <IconTerminal size={20} />
        </span>
        <p className="max-w-xs text-[13px] text-ink-2">{emptyMessage ?? td.toolTimelineEmpty}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Summary calls={toolCalls} isAgentRunning={isAgentRunning} thinkingMessage={thinkingLabel} />
      <ol className="tl">
        {items.map((item) =>
          item.kind === "tool_call" ? (
            <ToolCallRow key={`tc-${item.data.id}`} call={item.data} compact={compact} />
          ) : (
            <AgentTextRow key={`at-${item.data.id}`} item={item.data} />
          ),
        )}
        {showThinking && <ThinkingRow label={thinkingLabel} />}
      </ol>
    </div>
  );
}
