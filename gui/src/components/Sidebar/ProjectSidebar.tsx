"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useBoardStore } from "@/store/boardStore";
import { useProjects } from "@/hooks/useBoard";
import { NewProjectModal } from "@/components/Modals/NewProjectModal";
import { ProjectDetailDrawer } from "@/components/Modals/ProjectDetailDrawer";
import { useTranslation } from "@/hooks/useTranslation";

export function ProjectSidebar() {
  useProjects();

  const projects          = useBoardStore((s) => s.projects);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const selectProject     = useBoardStore((s) => s.selectProject);

  const [modalOpen,       setModalOpen]       = useState(false);
  const [search,          setSearch]          = useState("");
  const [menuOpenId,      setMenuOpenId]      = useState<string | null>(null);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const t = useTranslation();

  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpenId]);

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-base)]">
        {/* Title */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t.sidebar.title}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {projects.length}
          </span>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--border)] p-3">
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-[var(--text-faint)]">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.sidebar.searchPlaceholder}
              className="kanban-search w-full border border-[var(--border)] bg-[var(--bg-surface)] py-1.5 pl-7 pr-6 text-xs outline-none transition focus:border-[var(--text-secondary)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 font-mono text-[10px] text-[var(--text-faint)] hover:text-[var(--text-primary)]"
                aria-label="Clear"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Project list */}
        <nav className="flex flex-1 flex-col overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="t-quote text-base text-[var(--text-secondary)]">
                {search ? t.sidebar.emptySearch : t.sidebar.emptyAll}
              </p>
            </div>
          )}
          {filtered.map((p) => {
            const isSelected     = selectedProjectId === p.id;
            const isPlanning     = p.planningStatus === "planning";
            const isPlannerError = p.planningStatus === "error";
            const isMenuOpen     = menuOpenId === p.id;
            return (
              <div
                key={p.id}
                className="relative border-b border-[var(--border)]"
              >
                <button
                  type="button"
                  onClick={() => selectProject(p.id)}
                  className={clsx(
                    "group relative flex w-full items-start gap-3 px-4 py-3 pr-10 text-left transition",
                    isSelected
                      ? "bg-[var(--bg-surface)]"
                      : "hover:bg-[var(--bg-surface)]",
                  )}
                >
                  {/* selected accent */}
                  {isSelected && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent-primary)]"
                    />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-1.5 truncate text-[13px] font-medium leading-tight text-[var(--text-primary)]">
                      <span className="truncate">{p.name}</span>
                      {isPlanning && (
                        <span title={t.sidebar.plannerRunning} className="shrink-0">
                          <Spinner />
                        </span>
                      )}
                      {isPlannerError && (
                        <span
                          title={`${t.sidebar.plannerError}${p.planningError ? `: ${p.planningError}` : ""}`}
                          className="h-1.5 w-1.5 shrink-0 bg-[var(--status-error)]"
                        />
                      )}
                    </span>
                    <span className="truncate font-mono text-[11px] text-[var(--text-faint)]">
                      {p.repoPath}
                    </span>
                  </div>
                  <span
                    aria-hidden
                    className={clsx(
                      "absolute bottom-0 left-0 h-px transition-all duration-500",
                      isSelected ? "w-full bg-[var(--accent-primary)]" : "w-0 bg-[var(--accent-primary)] group-hover:w-1/3",
                    )}
                  />
                </button>

                {/* three-dot menu */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(isMenuOpen ? null : p.id);
                  }}
                  className={clsx(
                    "absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-1 transition",
                    isMenuOpen
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-faint)] hover:text-[var(--text-primary)]",
                  )}
                  aria-label="Project menu"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                    <circle cx="8" cy="2" r="1.3" />
                    <circle cx="8" cy="8" r="1.3" />
                    <circle cx="8" cy="14" r="1.3" />
                  </svg>
                </button>

                {isMenuOpen && (
                  <div
                    ref={menuRef}
                    className="absolute right-2 top-full z-50 mt-1 min-w-[150px] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-xl"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        setDetailProjectId(p.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM7.25 7a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v3.25h.25a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1 0-1.5h.25V7.75H7.25z" />
                      </svg>
                      {t.projectDetail.details}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer · new project */}
        <div className="border-t border-[var(--border)] p-3">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="group flex w-full items-center justify-between border border-dashed border-[var(--border)] px-3 py-2.5 text-[13px] text-[var(--text-muted)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="text-base leading-none">+</span>
              {t.sidebar.newProject}
            </span>
            <span aria-hidden className="opacity-0 transition group-hover:opacity-100">→</span>
          </button>
        </div>
      </aside>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <ProjectDetailDrawer
        projectId={detailProjectId}
        onClose={() => setDetailProjectId(null)}
      />
    </>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin"
      style={{ color: "var(--accent-primary)" }}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
