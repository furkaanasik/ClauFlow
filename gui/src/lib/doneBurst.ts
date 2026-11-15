"use client";

import { useEffect } from "react";
import { useBoardStore } from "@/store/boardStore";

/*
 * DONE drop celebration (spec §6). A task's card remounts in the DONE column
 * when its status flips, so the transition is recorded here (UI-only store
 * subscription, no data logic) and the freshly mounted card asks whether it
 * just arrived.
 */

const arrived = new Map<string, number>();
const WINDOW_MS = 1200;

/** Watch the board store for tasks entering DONE. Mount once (Board). */
export function useDoneBurstWatcher() {
  useEffect(
    () =>
      useBoardStore.subscribe((s, prev) => {
        if (s.tasks === prev.tasks) return;
        const now = performance.now();
        for (const id in s.tasks) {
          const before = prev.tasks[id];
          if (before && before.status !== "done" && s.tasks[id].status === "done") arrived.set(id, now);
        }
      }),
    [],
  );
}

/** True if the task entered DONE moments ago. */
export function justArrivedDone(id: string): boolean {
  const t = arrived.get(id);
  if (t === undefined) return false;
  if (performance.now() - t > WINDOW_MS) {
    arrived.delete(id);
    return false;
  }
  return true;
}
