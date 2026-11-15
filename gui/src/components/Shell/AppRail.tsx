"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ProjectSwitcher } from "@/components/Shell/ProjectSwitcher";
import { NewProjectModal } from "@/components/Modals/NewProjectModal";
import { ProjectDetailDrawer } from "@/components/Modals/ProjectDetailDrawer";
import { CloneRepoModal } from "@/components/Modals/CloneRepoModal";
import { IconButton } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  IconBoard,
  IconChart,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFactory,
  IconGithub,
  IconList,
  IconPlus,
  IconPR,
} from "@/components/ui/icons";
import { useBoardStore } from "@/store/boardStore";
import { useViewStore, type BoardView } from "@/store/viewStore";
import { useProjects } from "@/hooks/useBoard";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { useGithubRepos } from "@/hooks/useGithubRepos";
import { useTranslation } from "@/hooks/useTranslation";
import type { GithubRepo } from "@/types";

const REPO_PREVIEW = 5;

/**
 * Left rail (spec §5): logo, project switcher, views, GitHub repos to clone,
 * new project. Collapses to an icon rail; state persists in `rail-collapsed`.
 */
export function AppRail() {
  useProjects();
  const t = useTranslation();

  const collapsed = useViewStore((s) => s.railCollapsed);
  const setCollapsed = useViewStore((s) => s.setRailCollapsed);
  const hydrateRail = useViewStore((s) => s.hydrateRail);
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);
  useEffect(() => hydrateRail(), [hydrateRail]);
  const pathname = usePathname();
  const router = useRouter();
  const onBoard = pathname === "/board";
  const section = pathname?.startsWith("/github") ? "prs" : pathname?.startsWith("/insights") ? "insights" : null;

  const projects = useBoardStore((s) => s.projects);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  useGitStatus(selectedProjectId);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [cloneRepo, setCloneRepo] = useState<GithubRepo | null>(null);
  const [reposOpen, setReposOpen] = useState(true);
  const [reposAll, setReposAll] = useState(false);

  // Studio / project-detail intents raised elsewhere (task drawer, insights)
  const studioRequest = useBoardStore((s) => s.studioRequest);
  const closeStudio = useBoardStore((s) => s.closeStudio);
  const projectDetailRequest = useBoardStore((s) => s.projectDetailRequest);
  const clearProjectDetailRequest = useBoardStore((s) => s.clearProjectDetailRequest);
  useEffect(() => {
    if (studioRequest) setDetailProjectId(studioRequest.projectId);
  }, [studioRequest]);
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

  const { status: githubStatus } = useGithubAuth();
  const { repos } = useGithubRepos();
  const stripGit = (s: string | null | undefined) => (s ?? "").replace(/\.git$/, "").toLowerCase();
  const localRemotes = new Set(projects.map((p) => stripGit(p.remote)));
  const remoteRepos = repos.filter(
    (r) => !r.isLocal && !localRemotes.has(stripGit(r.url)) && !localRemotes.has(stripGit(r.sshUrl)),
  );

  const pq = selectedProjectId ? `?projectId=${selectedProjectId}` : "";
  const boardViews: { v: BoardView; icon: ReactNode }[] = [
    { v: "board", icon: <IconBoard size={17} /> },
    { v: "list", icon: <IconList size={17} /> },
    { v: "factory", icon: <IconFactory size={17} /> },
  ];

  const item = (key: string, label: string, icon: ReactNode, node: (cls: string, inner: ReactNode) => ReactNode, extra?: ReactNode) => {
    const inner = (
      <>
        <span className="grid w-5 flex-none place-items-center">{icon}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {!collapsed && extra}
      </>
    );
    const el = node(clsx("rail-item", collapsed && "rail-item--compact"), inner);
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
      <aside
        aria-label="ClauFlow"
        className={clsx(
          "relative z-20 flex h-full shrink-0 flex-col border-r-2 border-line bg-panel transition-[width] duration-200 ease-out",
          collapsed ? "w-[76px] items-center" : "w-[260px]",
        )}
      >
        {/* Logo */}
        <div className={clsx("flex h-16 w-full shrink-0 items-center border-b-2 border-line", collapsed ? "justify-center" : "gap-2 px-4")}>
          <Link href="/" className="ui-focus flex items-center gap-2.5 rounded-[10px]" aria-label={`ClauFlow · ${t.shell.home}`}>
            <Monogram />
            {!collapsed && <span className="text-[18px] font-extrabold tracking-[-0.03em] text-ink">ClauFlow</span>}
          </Link>
        </div>

        {/* Edge handle on the header border: visible in both states and clear of bottom-corner overlays */}
        <div className="absolute -right-[15px] top-[50px] z-30">
          <Tooltip content={collapsed ? t.shell.expandRail : t.shell.collapseRail} side="right">
            <button
              type="button"
              aria-label={collapsed ? t.shell.expandRail : t.shell.collapseRail}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
              className="ui-focus grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-panel text-ink shadow-hard transition-colors hover:bg-mustard"
            >
              {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
            </button>
          </Tooltip>
        </div>

        {/* Project switcher sits outside the scroller so its popover is never clipped */}
        <div className={clsx("relative z-10 w-full shrink-0 pt-4", collapsed ? "flex justify-center px-2" : "px-3")}>
          <ProjectSwitcher
            collapsed={collapsed}
            onNewProject={() => setNewProjectOpen(true)}
            onOpenDetails={setDetailProjectId}
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
                  (cls, inner) => (
                    <button
                      type="button"
                      className={cls}
                      aria-current={onBoard && view === v ? "page" : undefined}
                      onClick={() => {
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
              {item("prs", t.shell.viewNames.prs, <IconPR size={17} />, (cls, inner) => (
                <Link href={`/github${pq}`} className={cls} aria-current={section === "prs" ? "page" : undefined}>
                  {inner}
                </Link>
              ))}
              {item("insights", t.shell.viewNames.insights, <IconChart size={17} />, (cls, inner) => (
                <Link href={`/insights${pq}`} className={cls} aria-current={section === "insights" ? "page" : undefined}>
                  {inner}
                </Link>
              ))}
            </ul>
          </nav>

          {githubStatus.connected && remoteRepos.length > 0 && !collapsed && (
            <section aria-label={t.githubRepos.sectionTitle}>
              <button
                type="button"
                onClick={() => setReposOpen((v) => !v)}
                aria-expanded={reposOpen}
                className="ui-focus t-label mb-1.5 flex w-full items-center gap-2 rounded-[6px] px-2 !text-[10px]"
              >
                <IconGithub size={12} />
                <span className="flex-1 text-left">{t.githubRepos.sectionTitle}</span>
                <span className="font-mono">{remoteRepos.length}</span>
                <IconChevronDown size={12} className={clsx("transition-transform", !reposOpen && "-rotate-90")} />
              </button>
              {reposOpen && (
                <ul className="flex flex-col gap-0.5">
                  {(reposAll ? remoteRepos : remoteRepos.slice(0, REPO_PREVIEW)).map((repo) => (
                    <li key={repo.nameWithOwner}>
                      <button
                        type="button"
                        onClick={() => setCloneRepo(repo)}
                        title={`${t.shell.cloneRepo}: ${repo.nameWithOwner}`}
                        className="ui-menu__item group"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold text-ink">{repo.name}</span>
                          <span className="truncate font-mono text-[11px] text-ink-3">{repo.nameWithOwner}</span>
                        </span>
                        <span className="flex-none text-ink-3 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                          <IconDownload size={14} />
                        </span>
                      </button>
                    </li>
                  ))}
                  {remoteRepos.length > REPO_PREVIEW && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setReposAll((v) => !v)}
                        className="ui-focus mt-1 rounded-[6px] px-2.5 py-1 text-[12px] font-semibold text-[var(--cobalt-text)] hover:underline"
                      >
                        {reposAll ? t.shell.showLess : t.shell.showAll.replace("{n}", String(remoteRepos.length))}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className={clsx("flex w-full shrink-0 flex-col gap-2 border-t-2 border-line p-3", collapsed && "items-center")}>
          {collapsed ? (
            <Tooltip content={t.sidebar.newProject} side="right">
              <IconButton label={t.sidebar.newProject} size="md" onClick={() => setNewProjectOpen(true)}>
                <IconPlus size={16} />
              </IconButton>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => setNewProjectOpen(true)}
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
          closeStudio();
          closeTeamEditor();
        }}
      />
      <CloneRepoModal repo={cloneRepo} onClose={() => setCloneRepo(null)} />
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
