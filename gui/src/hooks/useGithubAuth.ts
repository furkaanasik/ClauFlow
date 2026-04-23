"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGithubAuthStatus,
  type GithubAuthStatus,
} from "@/lib/api";

const POLL_INTERVAL_MS = 5000;

export function useGithubAuth(pollWhileDisconnected: boolean = false) {
  const [status, setStatus] = useState<GithubAuthStatus>({
    connected: false,
    user: null,
    userCode: null,
    verificationUri: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getGithubAuthStatus();
      if (cancelledRef.current) return next;
      setStatus(next);
      setFetchError(null);
      return next;
    } catch (err) {
      if (!cancelledRef.current) {
        setFetchError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    refresh().catch(() => {
      /* error already stored */
    });
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pollWhileDisconnected || status.connected) return;

    timerRef.current = setTimeout(() => {
      refresh().catch(() => {
        /* error already stored */
      });
    }, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [pollWhileDisconnected, status, refresh]);

  return { status, loading, error: fetchError, refresh };
}
