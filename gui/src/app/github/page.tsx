"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PRDetailDrawer } from "@/components/Github/PRDetailDrawer";
import { githubApi, type PRListItem } from "@/lib/api";
import { PR_STATE_STYLES } from "@/lib/githubConstants";

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return iso;
  }
}

function GithubPRsContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");

  const [prs, setPrs] = useState<PRListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPR, setSelectedPR] = useState<PRListItem | null>(null);

  const fetchPrs = useCallback(() => {
    if (!projectId) {
      setError(
        "No project selected. Open the board, pick a project, then click the PR icon.",
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    githubApi.listPRs(projectId)
      .then((data) => {
        setPrs(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchPrs();
  }, [fetchPrs]);

  const counts = {
    OPEN: prs.filter((p) => p.state === "OPEN").length,
    MERGED: prs.filter((p) => p.state === "MERGED").length,
    CLOSED: prs.filter((p) => p.state === "CLOSED").length,
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg-base)]">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <Link
            href="/board"
            className="btn-ghost inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium"
          >
            <span aria-hidden>←</span>
            Board
          </Link>
          {!loading && !error && (
            <span className="ml-auto inline-flex items-center gap-3">
              <Counter label="Open"   value={counts.OPEN}   ink="var(--accent-primary)" />
              <Counter label="Merged" value={counts.MERGED} ink="var(--status-review)" />
              <Counter label="Closed" value={counts.CLOSED} ink="var(--status-error)" />
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10 flex items-end justify-between gap-6">
          <div>
            <h1 className="t-display text-4xl leading-tight text-[var(--text-primary)] md:text-5xl">
              Pull requests
            </h1>
            <p className="mt-3 max-w-md text-base text-[var(--text-secondary)]">
              Read the diff. Merge what ships. Comment to send the agent back.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center gap-4 border border-dashed border-[var(--border)] py-16">
            <div className="flex gap-1">
              <span className="animate-dot-1 h-1.5 w-1.5 bg-[var(--text-muted)]" />
              <span className="animate-dot-2 h-1.5 w-1.5 bg-[var(--text-muted)]" />
              <span className="animate-dot-3 h-1.5 w-1.5 bg-[var(--text-muted)]" />
            </div>
            <span className="text-[12px] text-[var(--text-muted)]">
              Loading pull requests…
            </span>
          </div>
        )}

        {error && (
          <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-4 py-3 text-sm text-[var(--status-error)]">
            {error}
          </div>
        )}

        {!loading && !error && prs.length === 0 && (
          <div className="flex flex-col items-center gap-2 border border-dashed border-[var(--border)] py-16">
            <p className="t-display text-2xl text-[var(--text-secondary)]">
              No pull requests
            </p>
            <p className="text-[12px] text-[var(--text-faint)]">
              Open a task and let the agent push the first one
            </p>
          </div>
        )}

        {!loading && !error && prs.length > 0 && (
          <div className="border border-[var(--border)]">
            {prs.map((pr) => {
              const stateStyle = PR_STATE_STYLES[pr.state] ?? PR_STATE_STYLES["OPEN"];
              return (
                <div
                  key={pr.number}
                  onClick={() => setSelectedPR(pr)}
                  className="group relative flex cursor-pointer items-center gap-5 overflow-hidden border-b border-[var(--border)] bg-[var(--bg-surface)] px-5 py-4 transition last:border-b-0 hover:bg-[var(--bg-elevated)]"
                >
                  {/* PR number */}
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[var(--text-muted)]">
                    #{pr.number}
                  </span>

                  {/* Title + meta */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="t-display truncate text-xl text-[var(--text-primary)] transition group-hover:text-[var(--accent-primary)]">
                      {pr.title}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      {pr.repository && (
                        <>
                          <span>{pr.repository.nameWithOwner}</span>
                          <span className="text-[var(--text-faint)]">·</span>
                        </>
                      )}
                      <span>@{pr.author?.login ?? "unknown"}</span>
                      <span className="text-[var(--text-faint)]">·</span>
                      <span className="font-mono tabular-nums">{formatDate(pr.createdAt)}</span>
                    </div>
                  </div>

                  {/* State */}
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium capitalize"
                    style={{ borderColor: stateStyle.ink, color: stateStyle.ink }}
                  >
                    <span className="h-1 w-1" style={{ background: stateStyle.ink }} />
                    {stateStyle.label}
                  </span>

                  {/* External */}
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 px-2 font-mono text-xs text-[var(--text-faint)] transition hover:text-[var(--text-primary)]"
                    title="Open on GitHub"
                  >
                    ↗
                  </a>

                  {/* hover line */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 h-px w-0 bg-[var(--accent-primary)] transition-all duration-500 group-hover:w-full"
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

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

function Counter({ label, value, ink }: { label: string; value: number; ink: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: ink, color: ink }}
    >
      <span className="h-1 w-1" style={{ background: ink }} />
      {label} <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

export default function GithubPRsPage() {
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
      <GithubPRsContent />
    </Suspense>
  );
}
