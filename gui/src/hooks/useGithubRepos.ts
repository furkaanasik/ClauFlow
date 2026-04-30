"use client";

import { useCallback, useEffect, useState } from "react";
import { getGithubRepos } from "@/lib/api";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import type { GithubRepo } from "@/types";

export function useGithubRepos() {
  const { status } = useGithubAuth();
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getGithubRepos();
      setRepos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!status.connected) {
      setRepos([]);
      return;
    }
    void refresh();
  }, [status.connected, refresh]);

  return { repos, loading, error, refresh };
}
