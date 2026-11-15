"use client";

import type { ReactNode } from "react";
import { AppRail } from "@/components/Shell/AppRail";
import { TopBar } from "@/components/Shell/TopBar";
import { ToastContainer } from "@/components/ui/Toast";

/**
 * Rail + top bar frame for the non-board views (PRs, insights). The board
 * page composes the same pieces itself because its main area is fixed-height.
 */
export function AppShell({ section, children }: { section: "prs" | "insights"; children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      <AppRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar section={section} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <ToastContainer />
    </div>
  );
}
