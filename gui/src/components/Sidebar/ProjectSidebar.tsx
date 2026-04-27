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

  // Close popover on click-outside
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
      <aside
        className="flex h-full w-56 shrink-0 flex-col border-r bg-[var(--bg-base)]"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Title */}
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            {t.sidebar.title}
          </span>
        </div>

        {/* Search */}
        <div className="border-b px-1.5 py-1.5" style={{ borderColor: "var(--border)" }}>
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-[var(--text-muted)] opacity-60">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.sidebar.searchPlaceholder}
              className="kanban-search w-full rounded-md border py-1 pl-6.5 pr-5 text-[10px] outline-none transition"
              style={{
                background:  "var(--bg-elevated)",
                borderColor: "var(--border)",
                color:       "var(--text-primary)",
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-[var(--text-muted)] opacity-60 hover:opacity-100 transition"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Project list */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[10px] text-[var(--text-muted)]">
              {search ? t.sidebar.emptySearch : t.sidebar.emptyAll}
            </p>
          )}
          {filtered.map((p) => {
            const isSelected     = selectedProjectId === p.id;
            const isPlanning     = p.planningStatus === "planning";
            const isPlannerError = p.planningStatus === "error";
            const isMenuOpen     = menuOpenId === p.id;
            return (
              <div key={p.id} className="relative">
                <button
                  type="button"
                  onClick={() => selectProject(p.id)}
                  className={clsx(
                    "group relative flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 pr-7 text-left transition",
                  )}
                  style={{
                    background: isSelected ? "var(--bg-surface)" : "transparent",
                    color:      isSelected ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected)
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  {/* Accent line */}
                  {isSelected && (
                    <span
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full"
                      style={{ background: "var(--accent-primary)" }}
                    />
                  )}
                  <span className="flex items-center gap-1 truncate text-xs font-medium leading-tight">
                    <span className="truncate">{p.name}</span>
                    {isPlanning && (
                      <span title={t.sidebar.plannerRunning} className="shrink-0">
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
                      </span>
                    )}
                    {isPlannerError && (
                      <span
                        title={`${t.sidebar.plannerError}${p.planningError ? `: ${p.planningError}` : ""}`}
                        className="h-2 w-2 shrink-0 rounded-full bg-red-500"
                      />
                    )}
                  </span>
                  <span
                    className="truncate font-mono text-[9px] transition"
                    style={{ color: isSelected ? "var(--text-muted)" : "var(--text-muted)", opacity: isSelected ? 0.7 : 0.5 }}
                  >
                    {p.repoPath}
                  </span>
                </button>

                {/* Three-dot menu button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(isMenuOpen ? null : p.id);
                  }}
                  className={clsx(
                    "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 transition",
                  )}
                  style={{
                    color:      isMenuOpen ? "var(--text-primary)" : "var(--text-muted)",
                    background: isMenuOpen ? "var(--bg-surface)" : "transparent",
                  }}
                  aria-label="Proje menüsü"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                    <circle cx="8" cy="2" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="8" cy="14" r="1.5" />
                  </svg>
                </button>

                {/* Popover menu */}
                {isMenuOpen && (
                  <div
                    ref={menuRef}
                    className="absolute right-0 top-full z-50 mt-0.5 min-w-[120px] rounded-lg border py-1 shadow-xl"
                    style={{
                      background:   "var(--bg-elevated)",
                      borderColor:  "var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        setDetailProjectId(p.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition"
                      style={{ color: "var(--text-muted)" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)";
                        (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM7.25 7a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v3.25h.25a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1 0-1.5h.25V7.75H7.25z"/>
                      </svg>
                      {t.projectDetail.details}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* New Project button */}
        <div className="border-t p-1.5" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-xs transition"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)";
              (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            }}
          >
            <span className="text-base leading-none">+</span>
            <span>{t.sidebar.newProject}</span>
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
