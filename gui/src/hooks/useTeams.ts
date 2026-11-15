"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import type { Team } from "@/types";

const EMPTY: Team[] = [];

/**
 * Teams usable by a project (built-ins, user templates, the project's own).
 * Cached per project in the store; refetched whenever `projectId` or `refreshKey` changes
 * so a drawer/modal opening always sees edits made elsewhere.
 */
export function useTeams(projectId: string | null | undefined, refreshKey?: unknown) {
  const teams = useBoardStore((s) => (projectId ? s.teamsByProject[projectId] ?? EMPTY : EMPTY));
  const cached = useBoardStore((s) => (projectId ? projectId in s.teamsByProject : false));
  const setTeams = useBoardStore((s) => s.setTeams);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    api
      .listTeams(projectId)
      .then((list) => {
        if (!cancelled) setTeams(projectId, list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, setTeams]);

  return { teams, loading: loading && !cached };
}
