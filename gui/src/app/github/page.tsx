"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PRDetailDrawer } from "@/components/Github/PRDetailDrawer";
import { githubApi, type PRListItem } from "@/lib/api";
import { PR_STATE_STYLES } from "@/lib/githubConstants";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function GithubPRsPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");

  const [prs, setPrs] = useState<PRListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPR, setSelectedPR] = useState<PRListItem | null>(null);

  const fetchPrs = useCallback(() => {
    if (!projectId) {
      setError("Proje secilmedi. Ana sayfadan bir proje secip PR butonuna tiklayin.");
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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link
            href="/board"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z" />
            </svg>
            <span>Kanban Board</span>
          </Link>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2">
            <GithubIcon className="h-4 w-4 text-zinc-400" />
            <span className="text-sm font-semibold text-zinc-100">GitHub Pull Requests</span>
          </div>
          {!loading && !error && (
            <span className="ml-auto rounded-full bg-zinc-800 px-2.5 py-0.5 font-mono text-[11px] text-zinc-400">
              {prs.length} PR
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-zinc-500">
            <div className="flex gap-1.5">
              <span className="animate-dot-1 h-2 w-2 rounded-full bg-zinc-600" />
              <span className="animate-dot-2 h-2 w-2 rounded-full bg-zinc-600" />
              <span className="animate-dot-3 h-2 w-2 rounded-full bg-zinc-600" />
            </div>
            <span className="text-sm">PRler yukleniyor...</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <span className="font-medium">Hata: </span>{error}
          </div>
        )}

        {!loading && !error && prs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-zinc-500">
            <GithubIcon className="h-8 w-8 text-zinc-700" />
            <span className="text-sm">Hic pull request bulunamadi.</span>
          </div>
        )}

        {!loading && !error && prs.length > 0 && (
          <div className="flex flex-col gap-2">
            {prs.map((pr) => {
              const stateStyle = PR_STATE_STYLES[pr.state] ?? PR_STATE_STYLES["OPEN"];
              return (
                <div
                  key={pr.number}
                  onClick={() => setSelectedPR(pr)}
                  className="flex cursor-pointer flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition hover:border-zinc-700 hover:bg-zinc-900/80 sm:flex-row sm:items-center"
                >
                  {/* PR number */}
                  <span className="shrink-0 font-mono text-xs text-zinc-600">
                    #{pr.number}
                  </span>

                  {/* Title + meta */}
                  <div className="flex flex-1 flex-col gap-1 overflow-hidden">
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-medium text-zinc-100 transition hover:text-blue-400"
                    >
                      {pr.title}
                    </a>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                      {pr.repository && (
                        <>
                          <span className="text-zinc-600">{pr.repository.nameWithOwner}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>@{pr.author?.login ?? "unknown"}</span>
                      <span>·</span>
                      <span>{formatDate(pr.createdAt)}</span>
                    </div>
                  </div>

                  {/* State badge */}
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${stateStyle.cls}`}
                  >
                    {stateStyle.label}
                  </span>

                  {/* External link */}
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-md p-1.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300"
                    title="GitHub'da ac"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                      <path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z" />
                      <path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z" />
                    </svg>
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

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
