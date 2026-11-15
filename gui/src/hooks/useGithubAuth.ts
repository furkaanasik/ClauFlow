"use client";

import { useEffect } from "react";
import { useGithubAuthStore } from "@/store/githubAuthStore";

const POLL_INTERVAL_MS = 5000;

let fetchedOnce = false;

/**
 * Shared GitHub auth status. The first mounted consumer triggers the only
 * initial fetch; `pollWhileDisconnected` re-checks every 5 s until connected
 * (the connect modal uses it while the device flow is pending).
 */
export function useGithubAuth(pollWhileDisconnected: boolean = false) {
  const status = useGithubAuthStore((s) => s.status);
  const loading = useGithubAuthStore((s) => s.loading);
  const error = useGithubAuthStore((s) => s.error);
  const refresh = useGithubAuthStore((s) => s.refresh);

  useEffect(() => {
    if (fetchedOnce) return;
    fetchedOnce = true;
    refresh().catch(() => {
      /* error stored in the slice */
    });
  }, [refresh]);

  useEffect(() => {
    if (!pollWhileDisconnected || status.connected) return;
    const id = setInterval(() => {
      refresh().catch(() => {
        /* error stored in the slice */
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollWhileDisconnected, status.connected, refresh]);

  return { status, loading, error, refresh };
}
