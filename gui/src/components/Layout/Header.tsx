"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useBoardStore } from "@/store/boardStore";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { GithubConnectModal } from "@/components/Auth/GithubConnectModal";
import { PrereqIndicator } from "@/components/Layout/PrereqIndicator";
import { useTranslation } from "@/hooks/useTranslation";

export function Header() {
  const wsConnected       = useBoardStore((s) => s.wsConnected);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const projects          = useBoardStore((s) => s.projects);
  const lang              = useBoardStore((s) => s.lang);
  const setLang           = useBoardStore((s) => s.setLang);
  const selectedTask      = useBoardStore((s) =>
    s.selectedTaskId ? s.tasks[s.selectedTaskId] ?? null : null,
  );

  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const { status: githubStatus } = useGithubAuth(githubModalOpen);
  const [isLight, setIsLight] = useState(false);

  const t = useTranslation();

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    html.classList.toggle("light");
    const nowLight = html.classList.contains("light");
    setIsLight(nowLight);
    localStorage.setItem("theme", nowLight ? "light" : "dark");
  };

  const toggleLang = () => {
    setLang(lang === "tr" ? "en" : "tr");
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-stretch border-b border-[var(--border)] bg-[var(--bg-base)]">
        {/* Logo */}
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 px-5 transition hover:opacity-80"
        >
          <Monogram />
          <span className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
            ClauFlow
          </span>
        </Link>

        {/* Divider */}
        <div className="my-3 w-px bg-[var(--border)]" />

        {/* Breadcrumb */}
        <div className="flex flex-1 items-center gap-2.5 overflow-hidden px-5">
          <Link
            href="/board"
            className="text-[13px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
          >
            Board
          </Link>
          {selectedProject && (
            <>
              <Slash />
              <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                {selectedProject.name}
              </span>
            </>
          )}
          {selectedTask && (
            <>
              <Slash />
              <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                #{selectedTask.id.slice(0, 7)}
              </span>
              {selectedTask.title && (
                <span className="truncate text-[13px] italic text-[var(--text-secondary)]">
                  {selectedTask.title.slice(0, 38)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Right action zone */}
        <div className="flex shrink-0 items-center gap-1 px-3">
          {/* WS status */}
          <span
            className="hidden items-center gap-1.5 px-2 sm:flex"
            title={wsConnected ? t.header.wsConnected : t.header.wsConnecting}
          >
            <span
              className={`h-1.5 w-1.5 ${
                wsConnected
                  ? "bg-[var(--accent-primary)]"
                  : "bg-[var(--text-faint)]"
              }`}
            />
            <span className="text-[11px] text-[var(--text-muted)]">
              {wsConnected ? "Live" : "Offline"}
            </span>
          </span>

          <PrereqIndicator />

          {selectedProjectId && (
            <Link
              href={`/github?projectId=${selectedProjectId}`}
              className="flex h-9 items-center gap-2 px-3 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
              title="Pull Requests"
            >
              <GithubIcon className="h-4 w-4" />
              <span className="hidden text-[12px] md:inline">PRs</span>
            </Link>
          )}

          <button
            type="button"
            onClick={toggleLang}
            className="flex h-9 items-center px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            title={lang === "tr" ? "Switch to English" : "Türkçeye geç"}
          >
            {lang === "tr" ? "TR" : "EN"}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            title={isLight ? t.header.themeToDark : t.header.themeToLight}
          >
            {isLight ? <MoonIcon /> : <SunIcon />}
          </button>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          {githubStatus.connected ? (
            <div
              className="flex h-9 items-center gap-2 px-3"
              title={githubStatus.user ? `@${githubStatus.user}` : t.header.githubConnected}
            >
              <span className="h-1.5 w-1.5 bg-[var(--accent-primary)]" />
              <GithubIcon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              {githubStatus.user && (
                <span className="hidden max-w-[120px] truncate text-[12px] text-[var(--text-primary)] sm:inline">
                  {githubStatus.user}
                </span>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setGithubModalOpen(true)}
              className="btn-ink flex h-9 items-center gap-2 px-4 font-mono text-[11px] uppercase tracking-[0.16em]"
            >
              <GithubIcon className="h-3.5 w-3.5" />
              <span>{t.header.githubConnect}</span>
            </button>
          )}
        </div>
      </header>

      <GithubConnectModal
        open={githubModalOpen}
        onClose={() => setGithubModalOpen(false)}
      />
    </>
  );
}

function Slash() {
  return (
    <span aria-hidden className="text-[13px] text-[var(--text-faint)]">
      /
    </span>
  );
}

function Monogram() {
  return (
    <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden border border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-base)]">
      <span className="font-mono text-[12px] font-bold leading-none">cf</span>
      <span className="absolute inset-y-0 right-0 w-[2px] bg-[var(--accent-primary)]" />
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
