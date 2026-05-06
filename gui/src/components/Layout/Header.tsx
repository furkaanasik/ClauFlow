"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useBoardStore } from "@/store/boardStore";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { GithubConnectModal } from "@/components/Auth/GithubConnectModal";
import { NewProjectModal } from "@/components/Modals/NewProjectModal";
import { useProjects } from "@/hooks/useBoard";

const NAV_ITEMS = [
  { id: "board",    icon: "▦", label: "Board",    href: "/board"    },
  { id: "studio",   icon: "◈", label: "Studio",   href: "/studio"   },
  { id: "insights", icon: "◉", label: "Insights", href: "/insights" },
  { id: "github",   icon: "⑂", label: "GitHub",   href: "/github"   },
];

export function Header() {
  const router   = useRouter();
  const pathname = usePathname();

  useProjects();

  const wsConnected       = useBoardStore((s) => s.wsConnected);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const projects          = useBoardStore((s) => s.projects);
  const selectProject     = useBoardStore((s) => s.selectProject);

  const [projOpen, setProjOpen]             = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const { status: githubStatus }      = useGithubAuth(githubModalOpen);
  const dropRef = useRef<HTMLDivElement>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  const activeId = pathname.startsWith("/insights")
    ? "insights"
    : pathname.startsWith("/github")
    ? "github"
    : pathname.startsWith("/studio")
    ? "studio"
    : "board";

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node))
        setProjOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <>
      <header
        style={{
          height: 48,
          borderBottom: "1px solid var(--cf-border)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 16,
          background: "var(--cf-surface)",
          flexShrink: 0,
          position: "relative",
          zIndex: 30,
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: 7, marginRight: 8, textDecoration: "none" }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            ⚡
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--cf-text)",
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-inter, Inter, sans-serif)",
            }}
          >
            ClauFlow
          </span>
        </Link>

        {/* Project switcher */}
        <div ref={dropRef} style={{ position: "relative" }}>
          <button
            onClick={() => setProjOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "var(--cf-card)",
              border: "1px solid var(--cf-border)",
              borderRadius: 7,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--cf-text)",
              cursor: "pointer",
              fontFamily: "var(--font-inter, Inter, sans-serif)",
            }}
          >
            <span
              style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }}
            />
            <span style={{ fontFamily: "monospace" }}>
              {selectedProject?.name ?? "no project"}
            </span>
            <span style={{ color: "var(--cf-muted)", fontSize: 10 }}>▾</span>
          </button>

          {projOpen && (
            <div
              style={{
                position: "absolute",
                top: 34,
                left: 0,
                background: "var(--cf-drawer)",
                border: "1px solid var(--cf-border)",
                borderRadius: 9,
                boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                minWidth: 200,
                overflow: "hidden",
                zIndex: 100,
                backdropFilter: "blur(12px)",
              }}
            >
              <div
                style={{
                  padding: "8px 12px 6px",
                  fontSize: 10,
                  color: "var(--cf-muted)",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Projects
              </div>
              {projects.length === 0 && (
                <div style={{ padding: "8px 12px 6px", fontSize: 12, color: "var(--cf-muted)", fontStyle: "italic" }}>
                  No projects yet
                </div>
              )}
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { selectProject(p.id); setProjOpen(false); }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: p.id === selectedProjectId ? "rgba(99,102,241,0.1)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--cf-text)",
                    fontSize: 13,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.07)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = p.id === selectedProjectId ? "rgba(99,102,241,0.1)" : "transparent"; }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }}
                  />
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{p.name}</span>
                  {p.remote && (
                    <span style={{ fontSize: 10, color: "var(--cf-muted)", marginLeft: "auto" }}>
                      {p.remote.replace(/^https?:\/\/github\.com\//, "")}
                    </span>
                  )}
                </button>
              ))}
              <div style={{ borderTop: "1px solid var(--cf-border)", margin: "4px 0" }} />
              <button
                onClick={() => { setProjOpen(false); setNewProjectOpen(true); }}
                style={{
                  width: "100%", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", background: "transparent",
                  border: "none", cursor: "pointer",
                  color: "#818cf8", fontSize: 12, fontWeight: 500,
                  marginBottom: 4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.07)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
                New project
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === activeId;
            const needsProject = item.id === "insights" || item.id === "github";
            const href = needsProject && selectedProjectId
              ? `${item.href}?projectId=${selectedProjectId}`
              : item.href;
            return (
              <button
                key={item.id}
                onClick={() => router.push(href)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: isActive ? "#818cf8" : "var(--cf-muted)",
                  fontSize: 13,
                  fontWeight: 500,
                  transition: "background 0.12s, color 0.12s",
                  fontFamily: "var(--font-inter, Inter, sans-serif)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.color = "var(--cf-text)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--cf-muted)";
                  }
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.8 }}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <span style={{ flex: 1 }} />

        {/* WS indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: "var(--cf-muted)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: wsConnected ? "#22c55e" : "#6b7280",
              boxShadow: wsConnected ? "0 0 6px #22c55e" : "none",
            }}
          />
          {wsConnected ? "Connected" : "Offline"}
        </div>

        {/* GitHub connect / status */}
        {!githubStatus.connected && (
          <button
            type="button"
            onClick={() => setGithubModalOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.3)",
              cursor: "pointer",
              color: "#818cf8",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            <GithubIcon />
            Connect
          </button>
        )}

        {/* Avatar */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "rgba(99,102,241,0.2)",
            border: "1px solid rgba(99,102,241,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            color: "#818cf8",
            cursor: "pointer",
            flexShrink: 0,
          }}
          title={githubStatus.user ?? "User"}
        >
          {githubStatus.user ? githubStatus.user.charAt(0).toUpperCase() : "U"}
        </div>
      </header>

      <GithubConnectModal
        open={githubModalOpen}
        onClose={() => setGithubModalOpen(false)}
      />

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
      />
    </>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
