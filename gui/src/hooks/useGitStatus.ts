import { useEffect } from "react";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";

const POLL_INTERVAL_MS = 30_000;

export function useGitStatus(projectId: string | null) {
  const setProjectGitStatus = useBoardStore((s) => s.setProjectGitStatus);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function fetchStatus() {
      try {
        const status = await api.getProjectGitStatus(projectId!);
        if (!cancelled) setProjectGitStatus(projectId!, status);
      } catch {
        // network errors silently ignored; non-git dirs return {branch:null} from server
      }
    }

    fetchStatus();
    const timer = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, setProjectGitStatus]);
}
