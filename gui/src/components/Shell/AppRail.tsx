"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ProjectSwitcher } from "@/components/Shell/ProjectSwitcher";
import { NewProjectModal } from "@/components/Modals/NewProjectModal";
import { ProjectDetailDrawer } from "@/components/Modals/ProjectDetailDrawer";
import { IconButton } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  IconBoard,
  IconChart,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFactory,
  IconList,
  IconPlus,
} from "@/components/ui/icons";
import { useEscapeLayer, useFocusTrap } from "@/components/ui/overlay";
import { useBoardStore } from "@/store/boardStore";
import { useViewStore, type BoardView } from "@/store/viewStore";
import { useProjects } from "@/hooks/useBoard";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useStashes } from "@/hooks/useStashes";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * Left rail (spec §5): logo, project switcher, views, new project (which also
 * clones from GitHub). Collapses to an icon rail; state persists in `rail-collapsed`.
 * Below `md` it is hidden and opens as a left overlay sheet (`mobileOpen`) from
 * the TopBar menu button; the sheet is always expanded.
 */
export function AppRail({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  useProjects();
  const t = useTranslation();
  const asideRef = useRef<HTMLElement>(null);

  const railCollapsed = useViewStore((s) => s.railCollapsed);
  const collapsed = railCollapsed && !mobileOpen;
  const setCollapsed = useViewStore((s) => s.setRailCollapsed);
  const hydrateRail = useViewStore((s) => s.hydrateRail);
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  useEffect(() => hydrateRail(), [hydrateRail]);
  const pathname = usePathname();
  const router = useRouter();
  const onBoard = pathname === "/board";
  const section = pathname?.startsWith("/insights") ? "insights" : null;

  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  useGitStatus(selectedProjectId);
  useStashes(selectedProjectId);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);

  const closeMobile = () => onMobileClose?.();
  useEscapeLayer(mobileOpen, closeMobile);
  useFocusTrap(asideRef, mobileOpen);
  // Leaving the mobile breakpoint (rotate / resize) closes the sheet.
  useEffect(() => {
    if (!mobileOpen) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => { if (mq.matches) onMobileClose?.(); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mobileOpen, onMobileClose]);

  // Team-editor / project-detail intents raised elsewhere (task drawer, insights)
  const projectDetailRequest = useBoardStore((s) => s.projectDetailRequest);
  const clearProjectDetailRequest = useBoardStore((s) => s.clearProjectDetailRequest);
  const teamEditorRequest = useBoardStore((s) => s.teamEditorRequest);
  const closeTeamEditor = useBoardStore((s) => s.closeTeamEditor);
  useEffect(() => {
    if (teamEditorRequest) setDetailProjectId(teamEditorRequest.projectId);
  }, [teamEditorRequest]);
  useEffect(() => {
    if (projectDetailRequest) {
      setDetailProjectId(projectDetailRequest);
      clearProjectDetailRequest();
    }
  }, [projectDetailRequest, clearProjectDetailRequest]);

  const pq = selectedProjectId ? `?projectId=${selectedProjectId}` : "";
  const boardViews: { v: BoardView; icon: ReactNode }[] = [
    { v: "board", icon: <IconBoard size={17} /> },
    { v: "list", icon: <IconList size={17} /> },
    { v: "factory", icon: <IconFactory size={17} /> },
  ];

  /** `ariaLabel` is set only on the icon-only (collapsed) rail, where the label text isn't rendered. */
  const item = (key: string, label: string, icon: ReactNode, node: (cls: string, inner: ReactNode, ariaLabel?: string) => ReactNode, extra?: ReactNode) => {
    const inner = (
      <>
        <span className="grid w-5 flex-none place-items-center">{icon}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {!collapsed && extra}
      </>
    );
    const el = node(clsx("rail-item", collapsed && "rail-item--compact"), inner, collapsed ? label : undefined);
    return (
      <li key={key}>
        {collapsed ? (
          <Tooltip content={label} side="right">
            {el as ReactElement<{ "aria-describedby"?: string }>}
          </Tooltip>
        ) : (
          el
        )}
      </li>
    );
  };

  return (
    <>
      {mobileOpen && <div className="ui-scrim z-40 md:hidden" onClick={closeMobile} aria-hidden />}
      <aside
        ref={asideRef}
        id="app-rail"
        aria-label="ClauFlow"
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
        tabIndex={mobileOpen ? -1 : undefined}
        className={clsx(
          "h-full shrink-0 flex-col border-r-2 border-line bg-panel",
          mobileOpen
            ? "rail-sheet fixed inset-y-0 left-0 z-50 flex w-[min(280px,86vw)] md:hidden"
            : "relative z-20 hidden transition-[width] duration-200 ease-out md:flex",
          !mobileOpen && (collapsed ? "w-[76px] items-center" : "w-[260px]"),
        )}
      >
        {/* Logo */}
        <div className={clsx("flex h-16 w-full shrink-0 items-center border-b-2 border-line", collapsed ? "justify-center" : "gap-2 px-4")}>
          <Link href="/?landing=1" className="ui-focus flex items-center gap-2.5 rounded-[10px]" aria-label={`ClauFlow · ${t.shell.home}`}>
            <Monogram />
            {!collapsed && <span className="text-[18px] font-extrabold tracking-[-0.03em] text-ink">ClauFlow</span>}
          </Link>
          {mobileOpen && (
            <IconButton label={t.shell.closeMenu} size="sm" variant="ghost" className="ml-auto" onClick={closeMobile} data-autofocus>
              <IconClose size={15} />
            </IconButton>
          )}
        </div>

        {/* Edge handle on the header border: visible in both states and clear of bottom-corner overlays */}
        {!mobileOpen && (
        <div className="absolute -right-[15px] top-[50px] z-30">
          <Tooltip content={collapsed ? t.shell.expandRail : t.shell.collapseRail} side="right">
            <button
              type="button"
              aria-label={collapsed ? t.shell.expandRail : t.shell.collapseRail}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!railCollapsed)}
              className="ui-focus grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-panel text-ink shadow-hard transition-colors hover:bg-mustard"
            >
              {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
            </button>
          </Tooltip>
        </div>
        )}

        {/* Project switcher sits outside the scroller so its popover is never clipped */}
        <div className={clsx("relative z-10 w-full shrink-0 pt-4", collapsed ? "flex justify-center px-2" : "px-3")}>
          <ProjectSwitcher
            collapsed={collapsed}
            onNewProject={() => {
              setNewProjectOpen(true);
              closeMobile();
            }}
            onOpenDetails={(id) => {
              setDetailProjectId(id);
              closeMobile();
            }}
          />
        </div>

        <div className={clsx("flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden pb-4 pt-5", collapsed ? "items-center px-2" : "px-3")}>

          <nav aria-label={t.shell.views} className={clsx(collapsed && "flex flex-col items-center")}>
            {!collapsed && <p className="t-label mb-2 px-2 !text-[10px]">{t.shell.views}</p>}
            <ul className={clsx("flex flex-col gap-1", collapsed && "items-center")}>
              {boardViews.map(({ v, icon }) =>
                item(
                  v,
                  t.shell.viewNames[v],
                  icon,
                  (cls, inner, ariaLabel) => (
                    <button
                      type="button"
                      className={cls}
                      aria-label={ariaLabel}
                      aria-current={onBoard && view === v ? "page" : undefined}
                      onClick={() => {
                        closeMobile();
                        setView(v);
                        if (!onBoard) {
                          const qs = new URLSearchParams();
                          if (selectedProjectId) qs.set("projectId", selectedProjectId);
                          if (v !== "board") qs.set("view", v);
                          const q = qs.toString();
                          router.push(`/board${q ? `?${q}` : ""}`);
                        }
                      }}
                    >
                      {inner}
                    </button>
                  ),
                  undefined,
                ),
              )}
              {item("insights", t.shell.viewNames.insights, <IconChart size={17} />, (cls, inner, ariaLabel) => (
                <Link href={`/insights${pq}`} className={cls} aria-label={ariaLabel} aria-current={section === "insights" ? "page" : undefined} onClick={closeMobile}>
                  {inner}
                </Link>
              ))}
            </ul>
          </nav>
        </div>

        {/* Footer */}
        <div className={clsx("flex w-full shrink-0 flex-col gap-2 border-t-2 border-line p-3", collapsed && "items-center")}>
          {collapsed ? (
            <Tooltip content={t.sidebar.newProject} side="right">
              <IconButton label={t.sidebar.newProject} size="md" onClick={() => { setNewProjectOpen(true); closeMobile(); }}>
                <IconPlus size={16} />
              </IconButton>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => { setNewProjectOpen(true); closeMobile(); }}
              className="ui-focus group flex h-10 w-full items-center gap-2.5 rounded-[10px] border-2 border-dashed border-line px-3 text-[14px] font-semibold text-ink-2 transition hover:border-solid hover:bg-mustard hover:text-[var(--on-mustard)] hover:shadow-[2px_2px_0_var(--shadow-ink)]"
            >
              <IconPlus size={15} />
              {t.sidebar.newProject}
            </button>
          )}
        </div>
      </aside>

      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <ProjectDetailDrawer
        projectId={detailProjectId}
        onClose={() => {
          setDetailProjectId(null);
          closeTeamEditor();
        }}
      />
    </>
  );
}

function Monogram() {
  return (
    <span
      aria-hidden
      className="relative grid h-9 w-9 flex-none place-items-center rounded-[10px] border-2 border-line bg-mustard font-mono text-[14px] font-extrabold leading-none text-[var(--on-mustard)] shadow-[2px_2px_0_var(--shadow-ink)]"
    >
      cf
      <span className="absolute -right-[3px] -top-[3px] h-2.5 w-2.5 rounded-full border-2 border-line bg-orange" />
    </span>
  );
}
