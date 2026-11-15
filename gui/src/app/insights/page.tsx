"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { AppShell } from "@/components/Shell/AppShell";
import { TaskDetailDrawer } from "@/components/Card/TaskDetailDrawer";
import { Button } from "@/components/ui/Button";
import { RingGauge } from "@/components/ui/Meters";
import { SectionPill, StatusPill, type StatusKind } from "@/components/ui/Pills";
import { useDismiss } from "@/components/ui/overlay";
import {
  IconAlert,
  IconBoard,
  IconChart,
  IconChevronDown,
  IconClock,
  IconCoin,
  IconDownload,
  IconList,
  IconRetry,
} from "@/components/ui/icons";
import { api, type InsightsData } from "@/lib/api";
import { formatDuration, formatTokens, formatUsd } from "@/lib/format";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/** Node-type swatch: stable token colour per type name. */
const SWATCHES = ["var(--cobalt)", "var(--green)", "var(--mustard)", "var(--orange)", "var(--ink-2)", "var(--red)"];
function swatch(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return SWATCHES[Math.abs(h) % SWATCHES.length];
}

function InsightsContent() {
  const t = useTranslation();
  const ti = t.insights;
  const projectId = useBoardStore((s) => s.selectedProjectId);
  const projectsLoaded = useBoardStore((s) => s.projects.length > 0);
  const upsertTask = useBoardStore((s) => s.upsertTask);
  const selectTask = useBoardStore((s) => s.selectTask);

  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const exportRef = useRef<HTMLDivElement>(null);
  useDismiss(exportRef, exportOpen, () => setExportOpen(false));

  // keep ?projectId= in the URL in step with the rail's project switcher
  useEffect(() => {
    if (!projectId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("projectId") === projectId) return;
    params.set("projectId", projectId);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [projectId]);

  const openTask = async (taskId: string) => {
    try {
      const task = await api.getTask(taskId);
      upsertTask(task);
      selectTask(taskId);
    } catch {
      // silently ignore — task may have been deleted
    }
  };

  useEffect(() => {
    if (!projectId) {
      setLoading(!projectsLoaded);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getInsights(projectId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectsLoaded, reload]);

  const s = data?.summary;
  const tokens = {
    input: s?.totalInputTokens ?? 0,
    output: s?.totalOutputTokens ?? 0,
    cacheRead: s?.totalCacheReadTokens ?? 0,
    cacheWrite: s?.totalCacheWriteTokens ?? 0,
  };
  const tokenTotal = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  const maxNodeTokens = Math.max(
    1,
    ...(data?.byNodeType ?? []).map((n) => n.inputTokens + n.outputTokens + n.cacheReadTokens + n.cacheWriteTokens),
  );

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7 px-8 pb-16 pt-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <SectionPill icon={<IconChart size={13} />}>{ti.eyebrow}</SectionPill>
          <h1 className="t-display mt-3 text-[34px] leading-[1.05] text-ink">{ti.title}</h1>
          <p className="mt-2 max-w-xl text-[14.5px] text-ink-2">{ti.subtitle}</p>
        </div>
        <div ref={exportRef} className="relative">
          <Button
            variant="secondary"
            icon={<IconDownload size={15} />}
            iconRight={<IconChevronDown size={13} />}
            onClick={() => setExportOpen((v) => !v)}
            disabled={!projectId}
            aria-expanded={exportOpen}
            aria-haspopup="menu"
          >
            {ti.exportButton}
          </Button>
          {exportOpen && projectId && (
            <div role="menu" className="ui-menu absolute right-0 top-[calc(100%+8px)] z-20 w-48">
              {(["json", "csv"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  role="menuitem"
                  className="ui-menu__item"
                  onClick={() => {
                    window.open(api.getInsightsExportUrl(projectId, fmt));
                    setExportOpen(false);
                  }}
                >
                  <IconDownload size={14} className="text-ink-3" />
                  <span className="flex-1 font-semibold">{fmt === "json" ? ti.exportJson : ti.exportCsv}</span>
                  <span className="font-mono text-[11px] text-ink-3">.{fmt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {loading && (
        <div className="flex flex-col gap-4" aria-busy aria-label={ti.loading}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="ui-hatch h-[150px] rounded-[14px] border-2 border-dashed border-hair" />
            ))}
          </div>
          <div className="ui-hatch h-[220px] rounded-[14px] border-2 border-dashed border-hair" />
        </div>
      )}

      {!loading && !projectId && (
        <Notice icon={<IconBoard size={20} />} title={ti.noProjectTitle} body={ti.noProject}>
          <Link href="/board" className="ui-btn ui-btn--secondary ui-btn--md ui-focus">
            <IconBoard size={15} />
            {ti.backToBoard}
          </Link>
        </Notice>
      )}

      {!loading && error && projectId && (
        <Notice icon={<IconAlert size={20} />} tone="error" title={ti.errorTitle} body={error} mono>
          <Button variant="secondary" icon={<IconRetry size={15} />} onClick={() => setReload((n) => n + 1)}>
            {ti.retry}
          </Button>
        </Notice>
      )}

      {!loading && !error && data && s && (
        <>
          {/* KPI tiles */}
          <section aria-label={ti.kpis} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile icon={<IconList size={15} />} label={ti.statTasks} value={String(s.totalTasks)} accent="var(--ink)">
              <SplitBar
                parts={[
                  { v: s.doneTasks, c: "var(--green)" },
                  { v: s.errorTasks, c: "var(--red)" },
                  { v: Math.max(0, s.totalTasks - s.doneTasks - s.errorTasks), c: "var(--sunken)" },
                ]}
              />
              <Legend
                items={[
                  { c: "var(--green)", l: ti.legendDone, v: s.doneTasks },
                  { c: "var(--red)", l: ti.legendError, v: s.errorTasks },
                ]}
              />
            </KpiTile>

            <KpiTile icon={<IconCoin size={15} />} label={ti.statCost} value={formatUsd(s.costUsd)} accent="var(--mustard)">
              <SplitBar
                parts={[
                  { v: tokens.input, c: "var(--cobalt)" },
                  { v: tokens.output, c: "var(--mustard)" },
                  { v: tokens.cacheRead, c: "var(--green)" },
                  { v: tokens.cacheWrite, c: "var(--orange)" },
                ]}
              />
              <span className="font-mono text-[11.5px] text-ink-3">
                {ti.tokensTotal.replace("{n}", formatTokens(tokenTotal))}
              </span>
              {s.planningCostUsd > 0 && (
                <span className="font-mono text-[11.5px] text-ink-3">
                  {ti.statCostPlanning.replace("{v}", formatUsd(s.planningCostUsd))}
                </span>
              )}
            </KpiTile>

            <KpiTile
              icon={<IconChart size={15} />}
              label={ti.statCompletion}
              value={s.totalTasks > 0 ? `${pct(s.doneTasks, s.totalTasks)}%` : "—"}
              accent="var(--green)"
              gauge={
                <RingGauge value={s.doneTasks} max={Math.max(1, s.totalTasks)} size={64} thickness={8} color="var(--green)" ariaLabel={ti.statCompletion}>
                  <span className="text-[11px]">{s.doneTasks}</span>
                </RingGauge>
              }
            >
              <span className="text-[12px] text-ink-3">{ti.statCompletionSub.replace("{prs}", String(s.prCount))}</span>
            </KpiTile>

            <KpiTile
              icon={<IconClock size={15} />}
              label={ti.statAvgRunTime}
              value={formatDuration(s.avgTimeToGreenMs, { empty: "—" })}
              accent="var(--cobalt)"
            >
              <span className="text-[12px] text-ink-3">
                {s.avgTimeToGreenMs !== null ? ti.statAvgRunTimeSub : ti.noRunsYet}
              </span>
            </KpiTile>
          </section>

          {/* Token legend */}
          {tokenTotal > 0 && (
            <Legend
              className="-mt-3"
              items={[
                { c: "var(--cobalt)", l: ti.tokInput, v: formatTokens(tokens.input) },
                { c: "var(--mustard)", l: ti.tokOutput, v: formatTokens(tokens.output) },
                { c: "var(--green)", l: ti.tokCacheRead, v: formatTokens(tokens.cacheRead) },
                { c: "var(--orange)", l: ti.tokCacheWrite, v: formatTokens(tokens.cacheWrite) },
              ]}
            />
          )}

          {/* By node type */}
          {data.byNodeType.length > 0 && (
            <section>
              <SecHead n={1} label={ti.sectionByNodeType} />
              <div className="ui-panel ui-panel--raised overflow-hidden">
                <table className="task-table">
                  <thead>
                    <tr>
                      <th>{ti.colNodeType}</th>
                      <th className="!text-right">{ti.colRuns}</th>
                      <th className="!text-right">{ti.colDone}</th>
                      <th className="w-[200px]">{ti.colSuccess}</th>
                      <th className="w-[220px]">{ti.colTokens}</th>
                      <th className="!text-right">{ti.colUsd}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byNodeType.map((n) => {
                      const tok = n.inputTokens + n.outputTokens + n.cacheReadTokens + n.cacheWriteTokens;
                      const success = pct(n.doneCount, n.runCount);
                      return (
                        <tr key={n.nodeType}>
                          <td>
                            <span className="inline-flex items-center gap-2 font-mono text-[13px] font-semibold text-ink">
                              <span aria-hidden className="h-3 w-3 rounded-[3px] border-[1.5px] border-line" style={{ background: swatch(n.nodeType) }} />
                              {(t.team.roles as Record<string, string>)[n.nodeType] ?? n.nodeType}
                            </span>
                          </td>
                          <td className="text-right font-mono tabular-nums">{n.runCount}</td>
                          <td className="text-right font-mono tabular-nums">{n.doneCount}</td>
                          <td>
                            <span className="flex items-center gap-2">
                              <Bar value={success} max={100} color={success >= 80 ? "var(--green)" : success >= 50 ? "var(--mustard)" : "var(--red)"} />
                              <span className="w-10 text-right font-mono text-[12px] font-semibold tabular-nums">
                                {n.runCount > 0 ? `${success}%` : "—"}
                              </span>
                            </span>
                          </td>
                          <td>
                            <span className="flex items-center gap-2">
                              <Bar value={tok} max={maxNodeTokens} color="var(--cobalt)" />
                              <span className="w-14 text-right font-mono text-[12px] tabular-nums">{tok > 0 ? formatTokens(tok) : "—"}</span>
                            </span>
                          </td>
                          <td className="text-right font-mono tabular-nums" title={n.estimated ? ti.costEstimated : undefined}>
                            {n.estimated ? "~" : ""}{formatUsd(n.costUsd, { precision: 3 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Recent tasks */}
          <section>
            <SecHead n={data.byNodeType.length > 0 ? 2 : 1} label={ti.sectionRecentTasks} />
            {data.recentTasks.length === 0 ? (
              <Notice icon={<IconList size={20} />} title={ti.emptyTasks} body={ti.emptyTasksHint}>
                <Link href={`/board?projectId=${projectId}`} className="ui-btn ui-btn--secondary ui-btn--md ui-focus">
                  <IconBoard size={15} />
                  {ti.backToBoard}
                </Link>
              </Notice>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.recentTasks.map((task) => {
                  const kind: StatusKind =
                    task.agentStatus === "error" ? "error" : (["todo", "doing", "review", "done"].includes(task.status) ? task.status : "info") as StatusKind;
                  const label =
                    task.agentStatus === "error"
                      ? ti.statusError
                      : (t.board.columns as Record<string, string>)[task.status] ?? task.status;
                  return (
                    <li key={task.id}>
                      <button type="button" onClick={() => void openTask(task.id)} className="ui-linkrow !min-h-[3.25rem] !px-3.5">
                        <span className="ui-keyplate !shadow-none">{task.displayId ?? `#${task.id.slice(0, 7)}`}</span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{task.title}</span>
                        <StatusPill status={kind}>{label}</StatusPill>
                        <span className="hidden w-[84px] items-center justify-end gap-1 font-mono text-[12px] tabular-nums text-ink-2 sm:inline-flex">
                          <IconCoin size={12} className="text-ink-3" />
                          {formatUsd(task.costUsd, { precision: 3 })}
                        </span>
                        <span className="hidden w-[78px] items-center justify-end gap-1 font-mono text-[12px] tabular-nums text-ink-3 md:inline-flex">
                          <IconClock size={12} />
                          {formatDuration(task.timeToGreenMs, { empty: "—" })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <TaskDetailDrawer />
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  accent,
  gauge,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent: string;
  gauge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="kpi-tile" style={{ "--kpi": accent } as CSSProperties}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="kpi-tile__icon">{icon}</span>
        <span className="t-label min-w-0 flex-1 truncate !text-[10.5px] !text-ink-2">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="font-mono text-[34px] font-bold leading-none tracking-[-0.03em] text-ink">{value}</span>
        {gauge}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function SplitBar({ parts }: { parts: { v: number; c: string }[] }) {
  const total = parts.reduce((a, p) => a + p.v, 0);
  return (
    <span className="flex h-3 w-full overflow-hidden rounded-pill border-2 border-line bg-sunken" aria-hidden>
      {total > 0 &&
        parts
          .filter((p) => p.v > 0)
          .map((p, i) => (
            <span
              key={i}
              className="h-full border-r-2 border-line last:border-r-0"
              style={{ width: `${(p.v / total) * 100}%`, background: p.c }}
            />
          ))}
    </span>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-pill border-[1.5px] border-line bg-sunken" aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-pill" style={{ width: `${w}%`, background: color }} />
    </span>
  );
}

function Legend({ items, className }: { items: { c: string; l: string; v: ReactNode }[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 ${className ?? ""}`}>
      {items.map((it) => (
        <li key={it.l} className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-line" style={{ background: it.c }} />
          {it.l}
          <span className="font-mono font-semibold text-ink">{it.v}</span>
        </li>
      ))}
    </ul>
  );
}

function SecHead({ n, label }: { n: number; label: string }) {
  return (
    <header className="ui-sechead">
      <span className="ui-sechead__n">§{String(n).padStart(2, "0")}</span>
      <h2 className="ui-sechead__t">{label}</h2>
    </header>
  );
}

function Notice({
  icon,
  title,
  body,
  tone,
  mono,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  tone?: "error";
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="ui-hatch flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-12 text-center">
      <span
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-[12px] border-2 border-line shadow-hard"
        style={tone === "error" ? { background: "var(--red)", color: "var(--on-red)" } : { background: "var(--panel)", color: "var(--ink-2)" }}
      >
        {icon}
      </span>
      <p className="t-display text-[20px] text-ink">{title}</p>
      <p className={mono ? "max-w-lg font-mono text-[12px] leading-relaxed text-ink-2" : "max-w-md text-[13.5px] text-ink-2"}>{body}</p>
      {children && <div className="mt-1 flex gap-2">{children}</div>}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <AppShell section="insights">
      <InsightsContent />
    </AppShell>
  );
}
