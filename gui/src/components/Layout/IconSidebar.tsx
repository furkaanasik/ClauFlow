"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useBoardStore } from "@/store/boardStore";
import { ProjectDetailDrawer } from "@/components/Modals/ProjectDetailDrawer";
import { NewProjectModal } from "@/components/Modals/NewProjectModal";

const NAV_ITEMS = [
  { id: "board",    icon: "▦", label: "Board",    href: "/board"    },
  { id: "studio",   icon: "◈", label: "Studio",   href: "/studio"   },
  { id: "insights", icon: "◉", label: "Insights", href: "/insights" },
  { id: "github",   icon: "⑂", label: "GitHub",   href: "/github"   },
];

export function IconSidebar() {
  const router   = useRouter();
  const pathname = usePathname();
  const [settingsOpen,    setSettingsOpen]    = useState(false);
  const [newProjectOpen,  setNewProjectOpen]  = useState(false);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);

  const activeId = pathname.startsWith("/insights")
    ? "insights"
    : pathname.startsWith("/github")
    ? "github"
    : pathname.startsWith("/studio")
    ? "studio"
    : "board";

  const handleSettings = () => {
    if (selectedProjectId) {
      setSettingsOpen(true);
    } else {
      setNewProjectOpen(true);
    }
  };

  return (
    <>
      <div
        style={{
          width: 44,
          flexShrink: 0,
          borderRight: "1px solid var(--cf-border)",
          background: "var(--cf-surface)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 12,
          gap: 4,
        }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeId;
          const needsProject = item.id === "insights" || item.id === "github";
          const href = needsProject && selectedProjectId
            ? `${item.href}?projectId=${selectedProjectId}`
            : item.href;
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => router.push(href)}
              style={{
                width: 32, height: 32, borderRadius: 7,
                background: isActive ? "rgba(99,102,241,0.15)" : "transparent",
                border: `1px solid ${isActive ? "rgba(99,102,241,0.3)" : "transparent"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 15,
                color: isActive ? "#818cf8" : "var(--cf-muted)",
                transition: "background 0.12s, color 0.12s",
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
              {item.icon}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <button
          title={selectedProjectId ? "Project Settings" : "New Project"}
          onClick={handleSettings}
          style={{
            width: 32, height: 32, borderRadius: 7,
            background: "transparent", border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: 15,
            color: "var(--cf-muted)", marginBottom: 12,
            transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cf-text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--cf-muted)"; }}
        >
          ⚙
        </button>
      </div>

      <ProjectDetailDrawer
        projectId={settingsOpen ? (selectedProjectId ?? null) : null}
        onClose={() => setSettingsOpen(false)}
      />

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
      />
    </>
  );
}
