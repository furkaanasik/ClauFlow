"use client";

import clsx from "clsx";
import { useCallback, useState, type ReactNode } from "react";
import { AppRail } from "@/components/Shell/AppRail";
import { TopBar } from "@/components/Shell/TopBar";
import { ToastContainer } from "@/components/ui/Toast";
import { useAgentSocket } from "@/hooks/useAgentSocket";

/**
 * Rail + top bar frame for every app view (plan §3/19). The board uses a
 * fixed-height main (its columns scroll themselves); insights scrolls the page.
 * The WebSocket lives here so the live status and task updates reach every view.
 * Below `md` the rail becomes an overlay opened from the TopBar menu button.
 */
export function AppShell({ section, children }: { section: "board" | "insights"; children: ReactNode }) {
  useAgentSocket();
  const [railOpen, setRailOpen] = useState(false);
  const closeRail = useCallback(() => setRailOpen(false), []);

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      <AppRail mobileOpen={railOpen} onMobileClose={closeRail} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          section={section === "insights" ? "insights" : undefined}
          menuOpen={railOpen}
          onOpenMenu={() => setRailOpen(true)}
        />
        <main
          className={clsx(
            "min-h-0 flex-1",
            section === "board"
              ? "flex flex-col overflow-hidden px-3 pb-3 pt-4 sm:px-6 sm:pt-5"
              : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
