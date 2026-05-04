"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, type InsightsData } from "@/lib/api";
import { formatTokens } from "@/lib/cost";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";
import { TaskDetailDrawer } from "@/components/Card/TaskDetailDrawer";

function formatTimeToGreen(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-4">
      <span className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
      <span className="t-display text-3xl text-[var(--text-primary)]">{value}</span>
      {sub && (
        <span className="text-[12px] text-[var(--text-faint)]">{sub}</span>
      )}
    </div>
  );
}

function InsightsContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  const t = useTranslation();
  const upsertTask = useBoardStore((s) => s.upsertTask);
  const selectTask = useBoardStore((s) => s.selectTask);

  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

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
      setError(t.insights.noProject);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getInsights(projectId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [projectId, t.insights.noProject]);

  const s = data?.summary;
  const completionRate =
    s && s.totalTasks > 0
      ? `${Math.round((s.doneTasks / s.totalTasks) * 100)}%`
      : "—";
  const ciPassRate =
    s?.ciPassRate !== null && s?.ciPassRate !== undefined
      ? `${Math.round(s.ciPassRate * 100)}%`
      : "—";

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <Link
            href="/board"
            className="btn-ghost inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium"
          >
            <span aria-hidden>←</span>
            Board
          </Link>

          <span className="text-[13px] text-[var(--text-muted)]">Fleet</span>

          {data && (
            <span className="text-[13px] text-[var(--text-faint)]">·</span>
          )}

          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
              disabled={!projectId}
            >
              {t.insights.exportButton}
              <span aria-hidden>▾</span>
            </button>
            {exportOpen && projectId && (
              <div className="absolute right-0 top-full mt-1 flex w-32 flex-col border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg">
                <button
                  type="button"
                  className="px-4 py-2 text-left text-[12px] text-[var(--text-primary)] transition hover:bg-[var(--bg-surface)]"
                  onClick={() => {
                    window.open(api.getInsightsExportUrl(projectId, "json"));
                    setExportOpen(false);
                  }}
                >
                  {t.insights.exportJson}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 text-left text-[12px] text-[var(--text-primary)] transition hover:bg-[var(--bg-surface)]"
                  onClick={() => {
                    window.open(api.getInsightsExportUrl(projectId, "csv"));
                    setExportOpen(false);
                  }}
                >
                  {t.insights.exportCsv}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10">
          <h1 className="t-display text-4xl leading-tight text-[var(--text-primary)] md:text-5xl">
            {t.insights.title}
          </h1>
          <p className="mt-3 max-w-md text-base text-[var(--text-secondary)]">
            {t.insights.subtitle}
          </p>
        </div>

        {loading && (
          <div className="flex flex-col items-center gap-4 border border-dashed border-[var(--border)] py-16">
            <div className="flex gap-1">
              <span className="animate-dot-1 h-1.5 w-1.5 bg-[var(--text-muted)]" />
              <span className="animate-dot-2 h-1.5 w-1.5 bg-[var(--text-muted)]" />
              <span className="animate-dot-3 h-1.5 w-1.5 bg-[var(--text-muted)]" />
            </div>
            <span className="text-[12px] text-[var(--text-muted)]">
              {t.insights.loading}
            </span>
          </div>
        )}

        {error && (
          <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-4 py-3 text-sm text-[var(--status-error)]">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                label={t.insights.statTasks}
                value={String(s?.totalTasks ?? 0)}
                sub={t.insights.statTasksSub
                  .replace("{done}", String(s?.doneTasks ?? 0))
                  .replace("{errors}", String(s?.errorTasks ?? 0))}
              />
              <StatCard
                label={t.insights.statCost}
                value={`$${(s?.estimatedUsd ?? 0).toFixed(2)}`}
                sub={
                  formatTokens(
                    (s?.totalInputTokens ?? 0) +
                      (s?.totalOutputTokens ?? 0) +
                      (s?.totalCacheReadTokens ?? 0) +
                      (s?.totalCacheWriteTokens ?? 0),
                  ) + " tokens"
                }
              />
              <StatCard
                label={t.insights.statCompletion}
                value={completionRate}
                sub={t.insights.statCompletionSub.replace(
                  "{prs}",
                  String(s?.prCount ?? 0),
                )}
              />
              <StatCard
                label={t.insights.statCiPassRate}
                value={ciPassRate}
                sub={
                  s?.avgTimeToGreenMs !== null &&
                  s?.avgTimeToGreenMs !== undefined
                    ? t.insights.statAvgTimeToGreen.replace(
                        "{time}",
                        formatTimeToGreen(s.avgTimeToGreenMs),
                      )
                    : undefined
                }
              />
            </div>

            {data.byNodeType.length > 0 && (
              <div className="mb-10">
                <h2 className="mb-3 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                  {t.insights.sectionByNodeType}
                </h2>
                <div className="border border-[var(--border)]">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
                        <th className="px-4 py-2 text-left font-medium text-[var(--text-muted)]">
                          {t.insights.colNodeType}
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-[var(--text-muted)]">
                          {t.insights.colRuns}
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-[var(--text-muted)]">
                          {t.insights.colDone}
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-[var(--text-muted)]">
                          {t.insights.colTokens}
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-[var(--text-muted)]">
                          {t.insights.colUsd}
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-[var(--text-muted)]">
                          {t.insights.colSuccess}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byNodeType.map((n) => (
                        <tr
                          key={n.nodeType}
                          className="border-b border-[var(--border)] bg-[var(--bg-base)] last:border-b-0 hover:bg-[var(--bg-elevated)]"
                        >
                          <td className="px-4 py-3 font-mono text-[var(--text-primary)]">
                            {n.nodeType}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {n.runCount}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {n.doneCount}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {n.inputTokens +
                              n.outputTokens +
                              n.cacheReadTokens +
                              n.cacheWriteTokens >
                            0
                              ? formatTokens(
                                  n.inputTokens +
                                    n.outputTokens +
                                    n.cacheReadTokens +
                                    n.cacheWriteTokens,
                                )
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                            ${n.estimatedUsd.toFixed(3)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {n.runCount > 0
                              ? `${Math.round((n.doneCount / n.runCount) * 100)}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-3 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
                {t.insights.sectionRecentTasks}
              </h2>
              {data.recentTasks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 border border-dashed border-[var(--border)] py-16">
                  <p className="t-display text-2xl text-[var(--text-secondary)]">
                    {t.insights.emptyTasks}
                  </p>
                  <p className="text-[12px] text-[var(--text-faint)]">
                    {t.insights.emptyTasksHint}
                  </p>
                </div>
              ) : (
                <div className="border border-[var(--border)]">
                  {data.recentTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => void openTask(task.id)}
                      className="flex cursor-pointer items-center gap-4 border-b border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3 last:border-b-0 hover:bg-[var(--bg-elevated)]"
                    >
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">
                        #{task.id.slice(0, 7)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">
                        {task.title}
                      </span>
                      <span
                        className="shrink-0 text-[11px]"
                        style={{
                          color:
                            task.agentStatus === "error"
                              ? "var(--status-error)"
                              : task.status === "done"
                                ? "var(--accent-primary)"
                                : "var(--text-muted)",
                        }}
                      >
                        {task.agentStatus === "error" ? "error" : task.status}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                        ${task.estimatedUsd.toFixed(4)}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                        {formatTimeToGreen(task.timeToGreenMs)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <TaskDetailDrawer />
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
          <span className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)]">
            loading…
          </span>
        </div>
      }
    >
      <InsightsContent />
    </Suspense>
  );
}
