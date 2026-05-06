"use client";

import { Header } from "@/components/Layout/Header";
import { IconSidebar } from "@/components/Layout/IconSidebar";
import { StudioCanvas } from "@/components/Studio/StudioCanvas";
import { ToastContainer } from "@/components/ui/Toast";
import { useBoardStore } from "@/store/boardStore";

export default function StudioPage() {
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--cf-bg)",
        fontFamily: "var(--font-inter, Inter, sans-serif)",
      }}
    >
      <Header />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <IconSidebar />
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {selectedProjectId ? (
            <StudioCanvas projectId={selectedProjectId} />
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 12,
                color: "var(--cf-muted)",
              }}
            >
              <span style={{ fontSize: 32 }}>◈</span>
              <span style={{ fontSize: 13 }}>No project selected</span>
              <span style={{ fontSize: 11, color: "var(--cf-muted)", opacity: 0.6 }}>
                Select or create a project first
              </span>
            </div>
          )}
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
