"use client";

import { Fragment, useState } from "react";
import { GithubConnectModal } from "@/components/Auth/GithubConnectModal";
import { PrereqIndicator } from "@/components/Layout/PrereqIndicator";
import { NotificationPopover } from "@/components/Layout/NotificationPopover";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { StatusPill } from "@/components/ui/Pills";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconChevronRight, IconClose, IconGithub, IconMoon, IconSearch, IconSun } from "@/components/ui/icons";
import { useBoardStore } from "@/store/boardStore";
import { useViewStore } from "@/store/viewStore";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { useTheme } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * Global top bar (spec §5): breadcrumb, task search (`/`), live status,
 * notifications, prerequisites, language, theme and the GitHub account.
 * Quick filters live in the board toolbar right under it.
 */
export function TopBar({ section }: { section?: "prs" | "insights" } = {}) {
  const t = useTranslation();
  const wsConnected = useBoardStore((s) => s.wsConnected);
  const lang = useBoardStore((s) => s.lang);
  const setLang = useBoardStore((s) => s.setLang);
  const filterText = useBoardStore((s) => s.filterText);
  const setFilterText = useBoardStore((s) => s.setFilterText);
  const project = useBoardStore((s) => s.projects.find((p) => p.id === s.selectedProjectId) ?? null);
  const selectedTask = useBoardStore((s) => (s.selectedTaskId ? s.tasks[s.selectedTaskId] ?? null : null));
  const view = useViewStore((s) => s.view);

  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const { status: githubStatus } = useGithubAuth(githubModalOpen);
  const { isNight, toggleTheme } = useTheme();

  const crumbs = [
    project?.name,
    t.shell.viewNames[section ?? view],
    !section && selectedTask ? selectedTask.displayId ?? `#${selectedTask.id.slice(0, 7)}` : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <>
      <header className="relative z-10 flex h-16 shrink-0 items-center gap-3 border-b-2 border-line bg-paper px-5">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5">
          <ol className="flex min-w-0 items-center gap-1.5">
            {crumbs.map((c, i) => (
              <Fragment key={`${i}-${c}`}>
                {i > 0 && (
                  <li aria-hidden className="flex-none text-ink-3">
                    <IconChevronRight size={13} />
                  </li>
                )}
                <li
                  aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  className={
                    i === crumbs.length - 1
                      ? "truncate text-[14px] font-bold text-ink"
                      : "truncate text-[14px] font-medium text-ink-3"
                  }
                >
                  {i === 2 ? <span className="font-mono text-[13px]">{c}</span> : c}
                </li>
              </Fragment>
            ))}
          </ol>
          {!section && selectedTask?.title && (
            <span className="hidden min-w-0 truncate text-[13px] text-ink-3 xl:inline">· {selectedTask.title}</span>
          )}
        </nav>

        {/* Search (board views only — it filters the board's tasks) */}
        {!section && (
        <div className="relative w-[300px] flex-none">
          <Input
            id="board-search"
            size="sm"
            icon={<IconSearch size={14} />}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filterText) {
                e.stopPropagation();
                setFilterText("");
              }
            }}
            placeholder={t.board.searchPlaceholder}
            aria-label={t.shell.searchLabel}
            className="!pr-9"
          />
          <span className="absolute inset-y-0 right-1.5 flex items-center">
            {filterText ? (
              <IconButton label={t.common.close} size="sm" variant="ghost" className="!h-6 !w-6" onClick={() => setFilterText("")}>
                <IconClose size={12} />
              </IconButton>
            ) : (
              <Kbd className="!h-5 !min-w-5">/</Kbd>
            )}
          </span>
        </div>
        )}

        <span title={wsConnected ? t.header.wsConnected : t.header.wsConnecting} className="hidden flex-none md:inline-flex">
          <StatusPill status={wsConnected ? "done" : "nothing"} live={wsConnected}>
            {wsConnected ? t.shell.live : t.shell.offline}
          </StatusPill>
        </span>

        <div className="flex flex-none items-center">
          <NotificationPopover />
          <PrereqIndicator />
        </div>

        <span aria-hidden className="h-6 w-[2px] flex-none rounded bg-hair" />

        <Tooltip content={t.shell.switchLang} side="bottom">
          <button
            type="button"
            onClick={() => setLang(lang === "tr" ? "en" : "tr")}
            aria-label={t.shell.switchLang}
            className="ui-focus grid h-8 min-w-8 flex-none place-items-center rounded-[8px] px-1.5 font-mono text-[12px] font-bold text-ink-2 transition hover:bg-hair hover:text-ink"
          >
            {lang === "tr" ? "TR" : "EN"}
          </button>
        </Tooltip>

        <Tooltip content={isNight ? t.header.themeToLight : t.header.themeToDark} side="bottom">
          <IconButton
            label={isNight ? t.header.themeToLight : t.header.themeToDark}
            size="sm"
            variant="ghost"
            onClick={toggleTheme}
          >
            {isNight ? <IconSun size={16} /> : <IconMoon size={16} />}
          </IconButton>
        </Tooltip>

        {githubStatus.connected ? (
          <span
            className="flex flex-none items-center gap-2 pl-1"
            title={githubStatus.user ? `@${githubStatus.user}` : t.header.githubConnected}
          >
            <Avatar name={githubStatus.user ?? "GitHub"} size="sm" state="online" />
            {githubStatus.user && (
              <span className="hidden max-w-[120px] truncate text-[13px] font-semibold text-ink lg:inline">
                {githubStatus.user}
              </span>
            )}
          </span>
        ) : (
          <Button size="sm" variant="primary" icon={<IconGithub size={14} />} onClick={() => setGithubModalOpen(true)}>
            {t.header.githubConnect}
          </Button>
        )}
      </header>

      <GithubConnectModal open={githubModalOpen} onClose={() => setGithubModalOpen(false)} />
    </>
  );
}
