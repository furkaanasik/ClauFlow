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

  const [modalOpen,      setModalOpen]      = useState(false);
  const [search,         setSearch]         = useState("");
  const [menuOpenId,     setMenuOpenId]     = useState<string | null>(null);
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
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/60">
        {/* Title */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {t.sidebar.title}
          </span>
        </div>

        {/* Search */}
        <div className="border-b border-zinc-800 px-2 py-2">
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-zinc-600">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.sidebar.searchPlaceholder}
              className="w-full rounded-md border border-zinc-800 bg-zinc-800/60 py-1.5 pl-7 pr-6 text-[11px] text-zinc-300 placeholder-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-zinc-600 hover:text-zinc-400"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Project list */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[11px] text-zinc-600">
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
                    "group relative flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 pr-8 text-left transition",
                    isSelected
                      ? "bg-zinc-800/80 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
                  )}
                >
                  {/* Accent line */}
                  {isSelected && (
                    <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-emerald-500" />
                  )}
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium leading-tight">
                    <span className="truncate">{p.name}</span>
                    {isPlanning && (
                      <span title={t.sidebar.plannerRunning} className="shrink-0">
                        <svg
                          className="h-3 w-3 animate-spin text-blue-400"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
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
                    className={clsx(
                      "truncate font-mono text-[10px] transition",
                      isSelected ? "text-zinc-500" : "text-zinc-600",
                    )}
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
                    "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-600 transition",
                    "hover:bg-zinc-700 hover:text-zinc-300",
                    isMenuOpen && "bg-zinc-700 text-zinc-300",
                  )}
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
                    className="absolute right-0 top-full z-50 mt-0.5 min-w-[120px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        setDetailProjectId(p.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
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
        <div className="border-t border-zinc-800 p-2">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-500 transition hover:border-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
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
