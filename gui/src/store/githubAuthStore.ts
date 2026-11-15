import { create } from "zustand";
import { getGithubAuthStatus, type GithubAuthStatus } from "@/lib/api";

const EMPTY_STATUS: GithubAuthStatus = {
  connected: false,
  user: null,
  userCode: null,
  verificationUri: null,
  error: null,
};

interface GithubAuthState {
  status: GithubAuthStatus;
  /** True until the first status fetch settles; consumers show nothing meanwhile. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<GithubAuthStatus>;
}

let inflight: Promise<GithubAuthStatus> | null = null;

/**
 * One shared GitHub auth slice (plan §3/17): every consumer (TopBar avatar,
 * PrereqIndicator row, clone tab, connect modal) reads the same status, and
 * concurrent refreshes collapse into a single request.
 */
export const useGithubAuthStore = create<GithubAuthState>((set) => ({
  status: EMPTY_STATUS,
  loading: true,
  error: null,
  refresh: () => {
    if (inflight) return inflight;
    inflight = getGithubAuthStatus()
      .then((status) => {
        set({ status, loading: false, error: null });
        return status;
      })
      .catch((err: unknown) => {
        set({ loading: false, error: err instanceof Error ? err.message : String(err) });
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
}));
