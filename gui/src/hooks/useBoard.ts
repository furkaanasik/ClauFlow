"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import type { Task, TaskPatch, TaskStatus } from "@/types";

export function useProjects() {
  const setProjects = useBoardStore((s) => s.setProjects);
  const selectProject = useBoardStore((s) => s.selectProject);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getProjects()
      .then((projects) => {
        if (cancelled) return;
        setProjects(projects);
        setError(null);
        if (!useBoardStore.getState().selectedProjectId && projects.length > 0) {
          selectProject(projects[0]!.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setProjects, selectProject]);

  return { loading, error, selectedProjectId };
}

export function useBoardTasks() {
  const setTasks = useBoardStore((s) => s.setTasks);
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedProjectId) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getTasks(selectedProjectId)
      .then((tasks) => {
        if (cancelled) return;
        setTasks(tasks);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, setTasks]);

  return { loading, error };
}

export async function moveTaskOptimistic(
  id: string,
  nextStatus: TaskStatus,
): Promise<void> {
  const { patchTaskLocal, rollbackTask, upsertTask } = useBoardStore.getState();
  const previous = patchTaskLocal(id, { status: nextStatus });
  if (!previous) return;
  try {
    const updated = await api.updateTask(id, { status: nextStatus });
    upsertTask(updated);
  } catch (err) {
    rollbackTask(id, previous);
    throw err;
  }
}

export async function patchTaskOptimistic(
  id: string,
  patch: TaskPatch,
): Promise<Task | undefined> {
  const { patchTaskLocal, rollbackTask, upsertTask } = useBoardStore.getState();
  const previous = patchTaskLocal(id, patch);
  if (!previous) return undefined;
  try {
    const updated = await api.updateTask(id, patch);
    upsertTask(updated);
    return updated;
  } catch (err) {
    rollbackTask(id, previous);
    throw err;
  }
}
