"use client";

import clsx from "clsx";
import { useCallback, useRef, useState, type CSSProperties } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconButton } from "@/components/ui/Button";
import { IconBranch, IconChevronDown, IconInfo, IconPlus, IconSearch, IconSpinner } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/overlay";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import type { GitStatus, Project } from "@/types";

interface ProjectSwitcherProps {
  collapsed: boolean;
  onNewProject: () => void;
  onOpenDetails: (projectId: string) => void;
}

/** Rail project picker: current project plate + searchable popover list. */
export function ProjectSwitcher({ collapsed, onNewProject, onOpenDetails }: ProjectSwitcherProps) {
  const t = useTranslation();
  const projects = useBoardStore((s) => s.projects);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const selectProject = useBoardStore((s) => s.selectProject);
  const gitStatusByProject = useBoardStore((s) => s.gitStatusByProject);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);
  useDismiss(ref, open, close);

  const current = projects.find((p) => p.id === selectedProjectId) ?? null;
  const git = current ? gitStatusByProject[current.id] : undefined;
  const q = search.trim().toLowerCase();
  const filtered = projects.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.repoPath.toLowerCase().includes(q),
  );

  const trigger = (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={collapsed ? `${t.shell.switchProject}: ${current?.name ?? t.shell.noProjectSelected}` : undefined}
      onClick={() => setOpen((v) => !v)}
      className={clsx(
        "ui-focus group flex items-center rounded-[12px] border-2 border-line bg-paper text-left transition",
        "hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_var(--shadow-ink)] active:translate-x-px active:translate-y-px active:shadow-none",
        collapsed ? "h-11 w-11 justify-center" : "w-full gap-2.5 px-2.5 py-2",
        open && "shadow-[3px_3px_0_var(--shadow-ink)]",
      )}
    >
      <Avatar name={current?.name ?? "?"} size="sm" />
      {!collapsed && (
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-bold leading-tight text-ink">
              {current?.name ?? t.shell.noProjectSelected}
            </span>
            <GitLine git={git} />
          </span>
          <IconChevronDown size={14} className={clsx("flex-none text-ink-2 transition-transform", open && "rotate-180")} />
        </>
      )}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      {collapsed ? (
        <Tooltip content={current?.name ?? t.shell.switchProject} side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}

      {open && (
        <div
          role="menu"
          aria-label={t.shell.switchProject}
          className={clsx(
            "ui-menu w-[300px] p-2",
            collapsed ? "left-[calc(100%+12px)] top-0" : "left-0 top-[calc(100%+8px)]",
          )}
        >
          <Input
            size="sm"
            icon={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.sidebar.searchPlaceholder}
            aria-label={t.sidebar.searchPlaceholder}
            autoFocus
          />
          <div className="mt-2 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-2 py-4 text-center text-[13px] text-ink-3">
                {q ? t.sidebar.emptySearch : t.sidebar.emptyAll}
              </p>
            )}
            {filtered.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                git={gitStatusByProject[p.id]}
                selected={p.id === selectedProjectId}
                onSelect={() => {
                  selectProject(p.id);
                  close();
                }}
                onDetails={() => {
                  onOpenDetails(p.id);
                  close();
                }}
              />
            ))}
          </div>
          <div className="mt-2 border-t-[1.5px] border-hair pt-2">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onNewProject();
                close();
              }}
              className="ui-menu__item font-semibold"
            >
              <span className="grid h-6 w-6 place-items-center rounded-[7px] border-2 border-dashed border-line" aria-hidden>
                <IconPlus size={12} />
              </span>
              {t.sidebar.newProject}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GitLine({ git }: { git?: GitStatus }) {
  const t = useTranslation();
  if (!git?.branch) {
    return <span className="font-mono text-[11px] text-ink-3">{t.shell.noBranch}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-ink-3">
      <IconBranch size={11} className="flex-none" />
      <span className="truncate">{git.branch}</span>
      <span
        className="ui-dot !h-[7px] !w-[7px] !border flex-none"
        style={{ "--dot": git.isDirty ? "var(--orange)" : "var(--green)" } as CSSProperties}
        title={git.isDirty ? t.shell.dirty : t.shell.clean}
        aria-label={git.isDirty ? t.shell.dirty : t.shell.clean}
        role="img"
      />
    </span>
  );
}

function ProjectRow({
  project,
  git,
  selected,
  onSelect,
  onDetails,
}: {
  project: Project;
  git?: GitStatus;
  selected: boolean;
  onSelect: () => void;
  onDetails: () => void;
}) {
  const t = useTranslation();
  const planning = project.planningStatus === "planning";
  const plannerError = project.planningStatus === "error";
  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        onClick={onSelect}
        className="ui-menu__item min-w-0 flex-1"
      >
        <Avatar name={project.name} size="xs" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 truncate font-semibold text-ink">
            <span className="truncate">{project.name}</span>
            {planning && (
              <span title={t.sidebar.plannerRunning} className="flex-none text-[var(--cobalt-text)]">
                <IconSpinner size={11} />
              </span>
            )}
            {plannerError && (
              <span
                title={`${t.sidebar.plannerError}${project.planningError ? `: ${project.planningError}` : ""}`}
                className="ui-dot !h-2 !w-2 !border flex-none"
                style={{ "--dot": "var(--red)" } as CSSProperties}
              />
            )}
          </span>
          {git?.branch ? (
            <GitLine git={git} />
          ) : (
            <span className="truncate font-mono text-[11px] text-ink-3">{project.repoPath}</span>
          )}
        </span>
      </button>
      <IconButton
        label={`${t.projectDetail.details}: ${project.name}`}
        size="sm"
        variant="ghost"
        onClick={onDetails}
        className="flex-none opacity-60 group-hover:opacity-100"
      >
        <IconInfo size={14} />
      </IconButton>
    </div>
  );
}
