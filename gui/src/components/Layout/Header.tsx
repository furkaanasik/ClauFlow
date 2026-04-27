"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useBoardStore } from "@/store/boardStore";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { GithubConnectModal } from "@/components/Auth/GithubConnectModal";
import { useTranslation } from "@/hooks/useTranslation";

export function Header() {
  const wsConnected       = useBoardStore((s) => s.wsConnected);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const projects          = useBoardStore((s) => s.projects);
  const lang              = useBoardStore((s) => s.lang);
  const setLang           = useBoardStore((s) => s.setLang);

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
      <header className="fixed inset-x-0 top-0 z-30 flex h-10 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/80 px-3 backdrop-blur-md">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-1.5 hover:opacity-80 transition-opacity">
          <ClauFlowIcon />
          <span className="text-xs font-semibold tracking-tight text-zinc-100">
            ClauFlow
          </span>
        </Link>

        {/* Breadcrumb */}
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          {selectedProject && (
            <>
              <span className="text-zinc-600">/</span>
              <span className="truncate text-sm font-medium text-zinc-300">
                {selectedProject.name}
              </span>
            </>
          )}
        </div>

        {/* Right section */}
        <div className="flex shrink-0 items-center gap-3">
          {/* GitHub PRs link — only show when a project is selected */}
          {selectedProjectId && (
            <Link
              href={`/github?projectId=${selectedProjectId}`}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              <GithubIcon className="h-3.5 w-3.5" />
              <span>PRs</span>
            </Link>
          )}

          {/* Language toggle */}
          <button
            type="button"
            onClick={toggleLang}
            className="flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            title={lang === "tr" ? "Switch to English" : "Türkçeye geç"}
          >
            {lang === "tr" ? "EN" : "TR"}
          </button>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center justify-center rounded-md px-1.5 py-0.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            title={isLight ? t.header.themeToDark : t.header.themeToLight}
          >
            {isLight ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

          <div className="h-4 w-px bg-zinc-800" />
          {/* WS status */}
          <div className="flex items-center gap-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                wsConnected ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            <span className="text-[10px] text-zinc-500">
              {wsConnected ? t.header.wsConnected : t.header.wsConnecting}
            </span>
          </div>

          {/* Separator */}
          <div className="h-4 w-px bg-zinc-800" />

          {/* GitHub connection */}
          {githubStatus.connected ? (
            <div
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-emerald-400"
              title={githubStatus.user ?? undefined}
            >
              <GithubIcon className="h-3.5 w-3.5" />
              <span className="max-w-[120px] truncate">
                {githubStatus.user ? `@${githubStatus.user}` : t.header.githubConnected}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setGithubModalOpen(true)}
              className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
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

function ClauFlowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="clf-grad" x1="0" y1="0" x2="18" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c3aed" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="18" height="18" rx="5" fill="url(#clf-grad)" />
      <path d="M4 6.5L6.5 9L4 11.5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 6.5L11 9L8.5 11.5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14.5" cy="9" r="1.2" fill="rgba(255,255,255,0.55)" />
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
