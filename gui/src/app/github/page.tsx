"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PRDetailDrawer } from "@/components/Github/PRDetailDrawer";
import { githubApi, type PRListItem } from "@/lib/api";
import { PR_STATE_STYLES } from "@/lib/githubConstants";
import { Header } from "@/components/Layout/Header";
import { IconSidebar } from "@/components/Layout/IconSidebar";
import { ToastContainer } from "@/components/ui/Toast";

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return iso; }
}

function GithubPRsContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");

  const [prs, setPrs]           = useState<PRListItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [selectedPR, setSelectedPR] = useState<PRListItem | null>(null);

  const fetchPrs = useCallback(() => {
    if (!projectId) {
      setError("No project selected. Open the board, pick a project, then click the PR icon.");
      setLoading(false);
      return;
    }
    setLoading(true);
    githubApi.listPRs(projectId)
      .then((data) => { setPrs(data); setError(null); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { fetchPrs(); }, [fetchPrs]);

  const counts = {
    OPEN:   prs.filter((p) => p.state === "OPEN").length,
    MERGED: prs.filter((p) => p.state === "MERGED").length,
    CLOSED: prs.filter((p) => p.state === "CLOSED").length,
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--cf-bg)" }} className="cf-scroll">
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", borderBottom: "1px solid var(--cf-border)" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--cf-text)", margin: 0 }}>
            Pull Requests
          </h1>
          <p style={{ fontSize: 12, color: "var(--cf-muted)", marginTop: 4 }}>
            Review, merge, or send the agent back for changes.
          </p>
        </div>
        {!loading && !error && (
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "Open",   count: counts.OPEN,   color: "#818cf8" },
              { label: "Merged", count: counts.MERGED, color: "#22c55e" },
              { label: "Closed", count: counts.CLOSED, color: "#6b7280" },
            ].map(({ label, count, color }) => (
              <span key={label} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: 20,
                background: `${color}18`, border: `1px solid ${color}44`,
                color, fontSize: 11, fontWeight: 600,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
                {label} <span style={{ fontFamily: "monospace" }}>{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "20px 28px" }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 0", color: "var(--cf-muted)", fontSize: 13 }}>
            Loading pull requests…
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

        {!loading && !error && prs.length === 0 && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "64px 0", borderRadius: 8, border: "1px dashed var(--cf-border)",
            color: "var(--cf-muted)", gap: 8,
          }}>
            <div style={{ fontSize: 28, opacity: 0.3 }}>⑂</div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--cf-text)" }}>No pull requests</p>
            <p style={{ margin: 0, fontSize: 12 }}>Open a task and let the agent push the first one</p>
          </div>
        )}

        {!loading && !error && prs.length > 0 && (
          <div style={{ borderRadius: 8, border: "1px solid var(--cf-border)", overflow: "hidden" }}>
            {prs.map((pr, idx) => {
              const stateStyle = PR_STATE_STYLES[pr.state] ?? PR_STATE_STYLES["OPEN"];
              return (
                <div
                  key={pr.number}
                  onClick={() => setSelectedPR(pr)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "12px 16px", cursor: "pointer",
                    borderBottom: idx < prs.length - 1 ? "1px solid var(--cf-border)" : "none",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--cf-card-hover)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  {/* PR number */}
                  <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: "var(--cf-muted)", flexShrink: 0 }}>
                    #{pr.number}
                  </span>

                  {/* Title + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--cf-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>
                      {pr.title}
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--cf-muted)" }}>
                      {pr.repository && <><span>{pr.repository.nameWithOwner}</span><span>·</span></>}
                      <span>@{pr.author?.login ?? "unknown"}</span>
                      <span>·</span>
                      <span style={{ fontFamily: "monospace" }}>{formatDate(pr.createdAt)}</span>
                    </div>
                  </div>

                  {/* State badge */}
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "2px 8px", borderRadius: 4,
                    background: `${stateStyle.ink}18`, border: `1px solid ${stateStyle.ink}44`,
                    color: stateStyle.ink, fontSize: 10, fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0,
                  }}>
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: stateStyle.ink }} />
                    {stateStyle.label}
                  </span>

                  {/* External link */}
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: "var(--cf-muted)", fontSize: 13, flexShrink: 0, textDecoration: "none" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#818cf8"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--cf-muted)"; }}
                    title="Open on GitHub"
                  >
                    ↗
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedPR && (
        <PRDetailDrawer
          pr={selectedPR}
          projectId={projectId ?? ""}
          onClose={() => setSelectedPR(null)}
          onMerged={() => { setSelectedPR(null); fetchPrs(); }}
        />
      )}
    </div>
  );
}

export default function GithubPRsPage() {
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
            <GithubPRsContent />
          </Suspense>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
