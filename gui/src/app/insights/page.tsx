"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, type InsightsData } from "@/lib/api";
import { formatTokens } from "@/lib/cost";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";
import { TaskDetailDrawer } from "@/components/Card/TaskDetailDrawer";
import { Header } from "@/components/Layout/Header";
import { IconSidebar } from "@/components/Layout/IconSidebar";
import { ToastContainer } from "@/components/ui/Toast";

function formatTimeToGreen(ms: number | null): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STAT_ACCENT: Record<string, string> = {
  cost: "#818cf8",
  success: "#22c55e",
};

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 4,
      padding: "14px 16px", borderRadius: 8,
      background: "var(--cf-card)", border: "1px solid var(--cf-border)",
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cf-muted)" }}>
        {label}
      </span>
      <span style={{ fontSize: 26, fontWeight: 700, color: accent ?? "var(--cf-text)", fontFamily: "monospace", lineHeight: 1.1 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: "var(--cf-muted)" }}>{sub}</span>}
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
    } catch { /* task may have been deleted */ }
  };

  useEffect(() => {
    if (!projectId) { setError(t.insights.noProject); setLoading(false); return; }
    setLoading(true);
    api.getInsights(projectId)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId, t.insights.noProject]);

  const s = data?.summary;
  const completionRate = s && s.totalTasks > 0 ? `${Math.round((s.doneTasks / s.totalTasks) * 100)}%` : "—";
  const ciPassRate     = s?.ciPassRate != null ? `${Math.round(s.ciPassRate * 100)}%` : "—";

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--cf-bg)" }} className="cf-scroll">
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px 0", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--cf-text)", margin: 0 }}>
            {t.insights.title}
          </h1>
          <p style={{ fontSize: 12, color: "var(--cf-muted)", marginTop: 4 }}>
            {t.insights.subtitle}
          </p>
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            disabled={!projectId}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 14px", fontSize: 12, fontWeight: 500,
              background: "var(--cf-card)", border: "1px solid var(--cf-border)",
              borderRadius: 6, color: "var(--cf-text)", cursor: "pointer",
            }}
          >
            {t.insights.exportButton} <span>▾</span>
          </button>
          {exportOpen && projectId && (
            <div style={{
              position: "absolute", top: 36, right: 0, zIndex: 20,
              background: "var(--cf-drawer)", border: "1px solid var(--cf-border)",
              borderRadius: 8, overflow: "hidden", minWidth: 120,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}>
              {["json", "csv"].map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  style={{
                    width: "100%", textAlign: "left", padding: "8px 14px",
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--cf-text)", fontSize: 12,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  onClick={() => { window.open(api.getInsightsExportUrl(projectId, fmt as "json" | "csv")); setExportOpen(false); }}
                >
                  {fmt === "json" ? t.insights.exportJson : t.insights.exportCsv}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "0 28px 32px" }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 0", color: "var(--cf-muted)", fontSize: 13 }}>
            {t.insights.loading}
          </div>
        )}

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 6,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
            color: "#ef4444", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {data.summary.pricingStale === true && (
              <div style={{
                marginBottom: 16, padding: "10px 14px", borderRadius: 6,
                background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)",
                color: "#f59e0b", fontSize: 12, display: "flex", gap: 8,
              }}>
                <span>⚠</span>
                <span>
                  {t.insights.pricingStaleBanner}{" "}
                  <span style={{ opacity: 0.7 }}>{t.insights.pricingStaleDate.replace("{date}", "2026-05-04")}</span>
                </span>
              </div>
            )}

            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              <StatCard
                label={t.insights.statTasks}
                value={String(s?.totalTasks ?? 0)}
                sub={t.insights.statTasksSub.replace("{done}", String(s?.doneTasks ?? 0)).replace("{errors}", String(s?.errorTasks ?? 0))}
              />
              <StatCard
                label={t.insights.statCost}
                value={`$${(s?.estimatedUsd ?? 0).toFixed(2)}`}
                accent={STAT_ACCENT.cost}
                sub={formatTokens((s?.totalInputTokens ?? 0) + (s?.totalOutputTokens ?? 0) + (s?.totalCacheReadTokens ?? 0) + (s?.totalCacheWriteTokens ?? 0)) + " tokens"}
              />
              <StatCard
                label={t.insights.statCompletion}
                value={completionRate}
                accent={STAT_ACCENT.success}
                sub={t.insights.statCompletionSub.replace("{prs}", String(s?.prCount ?? 0))}
              />
              <StatCard
                label={t.insights.statCiPassRate}
                value={ciPassRate}
                sub={s?.avgTimeToGreenMs != null ? t.insights.statAvgTimeToGreen.replace("{time}", formatTimeToGreen(s.avgTimeToGreenMs)) : undefined}
              />
            </div>

            {/* By node type table */}
            {data.byNodeType.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cf-muted)", marginBottom: 10 }}>
                  {t.insights.sectionByNodeType}
                </div>
                <div style={{ borderRadius: 8, border: "1px solid var(--cf-border)", overflow: "hidden" }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--cf-card)", borderBottom: "1px solid var(--cf-border)" }}>
                        {[t.insights.colNodeType, t.insights.colRuns, t.insights.colDone, t.insights.colTokens, t.insights.colUsd, t.insights.colSuccess].map((col, i) => (
                          <th key={i} style={{ padding: "8px 14px", textAlign: i === 0 ? "left" : "right", color: "var(--cf-muted)", fontWeight: 600, fontSize: 11 }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.byNodeType.map((n) => {
                        const totalTok = n.inputTokens + n.outputTokens + n.cacheReadTokens + n.cacheWriteTokens;
                        return (
                          <tr key={n.nodeType} style={{ borderBottom: "1px solid var(--cf-border)" }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--cf-card-hover)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                          >
                            <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "var(--cf-text)" }}>{n.nodeType}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--cf-muted)", fontFamily: "monospace" }}>{n.runCount}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--cf-muted)", fontFamily: "monospace" }}>{n.doneCount}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--cf-muted)", fontFamily: "monospace" }}>{totalTok > 0 ? formatTokens(totalTok) : "—"}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--cf-muted)", fontFamily: "monospace" }}>${n.estimatedUsd.toFixed(3)}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "var(--cf-muted)", fontFamily: "monospace" }}>
                              {n.runCount > 0 ? `${Math.round((n.doneCount / n.runCount) * 100)}%` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent tasks */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cf-muted)", marginBottom: 10 }}>
                {t.insights.sectionRecentTasks}
              </div>
              {data.recentTasks.length === 0 ? (
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  padding: "48px 0", borderRadius: 8, border: "1px dashed var(--cf-border)",
                  color: "var(--cf-muted)", fontSize: 13, gap: 8,
                }}>
                  <div style={{ fontSize: 28, opacity: 0.3 }}>◻</div>
                  <p style={{ margin: 0 }}>{t.insights.emptyTasks}</p>
                  <p style={{ margin: 0, fontSize: 11 }}>{t.insights.emptyTasksHint}</p>
                </div>
              ) : (
                <div style={{ borderRadius: 8, border: "1px solid var(--cf-border)", overflow: "hidden" }}>
                  {data.recentTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => void openTask(task.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 14px", cursor: "pointer",
                        borderBottom: "1px solid var(--cf-border)",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--cf-card-hover)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                    >
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--cf-muted)", flexShrink: 0 }}>
                        #{task.id.slice(0, 7)}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--cf-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {task.title}
                      </span>
                      <span style={{
                        fontSize: 11, flexShrink: 0,
                        color: task.agentStatus === "error" ? "#ef4444" : task.status === "done" ? "#22c55e" : "var(--cf-muted)",
                      }}>
                        {task.agentStatus === "error" ? "error" : task.status}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--cf-muted)", flexShrink: 0 }}>
                        ${task.estimatedUsd.toFixed(4)}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--cf-muted)", flexShrink: 0 }}>
                        {formatTimeToGreen(task.timeToGreenMs)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <TaskDetailDrawer />
    </div>
  );
}

export default function InsightsPage() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden",
      background: "var(--cf-bg)", fontFamily: "var(--font-inter, Inter, sans-serif)",
    }}>
      <Header />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <IconSidebar />
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--cf-bg)" }}>
          <Suspense
            fallback={
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--cf-muted)", fontSize: 12 }}>
                loading…
              </div>
            }
          >
            <InsightsContent />
          </Suspense>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
