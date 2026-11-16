import { useEffect } from "react";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import type { StashEntry } from "@/types";

/**
 * zincir E6 (plan §5.9): reloads a project's ClauFlow stashes into the store
 * (`stashesByProject` + `stashCountByProject`). Called when a project opens,
 * on `stash_created` and after a restore/drop. Errors leave the last list.
 */
export async function refreshStashes(projectId: string): Promise<StashEntry[] | null> {
  try {
    const stashes = await api.listStashes(projectId);
    useBoardStore.getState().setProjectStashes(projectId, stashes);
    return stashes;
  } catch {
    return null;
  }
}

/** Loads the open project's stash list once per project switch. */
export function useStashes(projectId: string | null) {
  useEffect(() => {
    if (projectId) void refreshStashes(projectId);
  }, [projectId]);
}
