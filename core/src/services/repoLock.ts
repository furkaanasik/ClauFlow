import { realpathSync } from "node:fs";

/**
 * In-process, per-repository mutex. Anything that changes a repo's working
 * tree or HEAD (executor runs, comment runs, merges, the CLAUDE.md editor)
 * holds this lock. The key is the repo's real path, so two projects that point
 * at the same repo (or a symlink to it) share one lock.
 */

export interface RepoLease {
  readonly key: string;
  readonly owner: string;
  release(): void;
}

export interface RepoLockHolder {
  owner: string;
  since: string;
}

interface Waiter {
  owner: string;
  resolve: (lease: RepoLease) => void;
}

interface LockState {
  holder: { owner: string; since: string; lease: RepoLease } | null;
  queue: Waiter[];
}

const LOCKS = new Map<string, LockState>();

export function repoLockKey(repoPath: string): string {
  try {
    return realpathSync(repoPath);
  } catch {
    return repoPath;
  }
}

function stateFor(key: string): LockState {
  let s = LOCKS.get(key);
  if (!s) {
    s = { holder: null, queue: [] };
    LOCKS.set(key, s);
  }
  return s;
}

function grant(key: string, state: LockState, owner: string): RepoLease {
  let released = false;
  const lease: RepoLease = {
    key,
    owner,
    release() {
      if (released) return;
      released = true;
      if (state.holder?.lease !== lease) return;
      state.holder = null;
      const next = state.queue.shift();
      if (next) {
        next.resolve(grant(key, state, next.owner));
      } else if (LOCKS.get(key) === state) {
        LOCKS.delete(key);
      }
    },
  };
  state.holder = { owner, since: new Date().toISOString(), lease };
  return lease;
}

export class RepoLockAbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

/** Waits (FIFO, no timeout) for the repo lock. Aborting `signal` drops the waiter. */
export function acquireRepoLock(
  repoPath: string,
  opts: { owner: string; signal?: AbortSignal },
): Promise<RepoLease> {
  const key = repoLockKey(repoPath);
  if (opts.signal?.aborted) return Promise.reject(new RepoLockAbortedError());
  const state = stateFor(key);
  if (!state.holder && state.queue.length === 0) {
    return Promise.resolve(grant(key, state, opts.owner));
  }
  return new Promise<RepoLease>((resolve, reject) => {
    const onAbort = () => {
      const idx = state.queue.indexOf(waiter);
      if (idx >= 0) state.queue.splice(idx, 1);
      reject(new RepoLockAbortedError());
    };
    const waiter: Waiter = {
      owner: opts.owner,
      resolve: (lease) => {
        opts.signal?.removeEventListener("abort", onAbort);
        resolve(lease);
      },
    };
    state.queue.push(waiter);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Non-blocking variant for HTTP handlers: `null` when the repo is busy. */
export function tryAcquireRepoLock(repoPath: string, owner: string): RepoLease | null {
  const key = repoLockKey(repoPath);
  const state = stateFor(key);
  if (state.holder || state.queue.length > 0) return null;
  return grant(key, state, owner);
}

export function getRepoLockHolder(repoPath: string): RepoLockHolder | null {
  const h = LOCKS.get(repoLockKey(repoPath))?.holder;
  return h ? { owner: h.owner, since: h.since } : null;
}

export function getRepoLockQueue(repoPath: string): string[] {
  return (LOCKS.get(repoLockKey(repoPath))?.queue ?? []).map((w) => w.owner);
}
