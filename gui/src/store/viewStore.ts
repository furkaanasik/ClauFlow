import { create } from "zustand";
import type { TaskPriority } from "@/types";

/**
 * UI-only state for the board shell: which view is showing, whether the left
 * rail is collapsed and the client-side quick filters. Kept apart from
 * `boardStore` on purpose — nothing here touches task data or the API.
 */

export type BoardView = "board" | "list" | "factory";

export const BOARD_VIEWS: BoardView[] = ["board", "list", "factory"];

const RAIL_KEY = "rail-collapsed";

export interface QuickFilters {
  priorities: TaskPriority[];
  tags: string[];
  agentRunning: boolean;
  prOpen: boolean;
}

export const EMPTY_FILTERS: QuickFilters = {
  priorities: [],
  tags: [],
  agentRunning: false,
  prOpen: false,
};

interface ViewState {
  view: BoardView;
  railCollapsed: boolean;
  filters: QuickFilters;

  setView: (view: BoardView) => void;
  setRailCollapsed: (collapsed: boolean) => void;
  hydrateRail: () => void;
  togglePriority: (p: TaskPriority) => void;
  toggleTag: (tag: string) => void;
  setAgentRunning: (on: boolean) => void;
  setPrOpen: (on: boolean) => void;
  clearFilters: () => void;
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export const useViewStore = create<ViewState>((set) => ({
  view: "board",
  railCollapsed: false,
  filters: EMPTY_FILTERS,

  setView: (view) => set({ view }),
  setRailCollapsed: (railCollapsed) => {
    try {
      localStorage.setItem(RAIL_KEY, railCollapsed ? "1" : "0");
    } catch {}
    set({ railCollapsed });
  },
  hydrateRail: () => {
    try {
      set({ railCollapsed: localStorage.getItem(RAIL_KEY) === "1" });
    } catch {}
  },
  togglePriority: (p) =>
    set((s) => ({ filters: { ...s.filters, priorities: toggle(s.filters.priorities, p) } })),
  toggleTag: (tag) =>
    set((s) => ({ filters: { ...s.filters, tags: toggle(s.filters.tags, tag) } })),
  setAgentRunning: (agentRunning) => set((s) => ({ filters: { ...s.filters, agentRunning } })),
  setPrOpen: (prOpen) => set((s) => ({ filters: { ...s.filters, prOpen } })),
  clearFilters: () => set({ filters: EMPTY_FILTERS }),
}));

export function activeFilterCount(f: QuickFilters): number {
  return f.priorities.length + f.tags.length + (f.agentRunning ? 1 : 0) + (f.prOpen ? 1 : 0);
}
