import { run } from "./gitService.js";
import { repoLockKey } from "./repoLock.js";
import type { Project } from "../types/index.js";

/**
 * `hasRemote` is derived, never stored (plan §3/8): `projects.remote` is
 * written once at creation and goes stale. Computed from `git remote` and
 * cached per repo (real path) for 30 s; a project update that changes the
 * repo path drops the entry.
 */

export const HAS_REMOTE_TTL_MS = 30_000;

const CACHE = new Map<string, { value: boolean; at: number }>();

export async function repoHasRemote(repoPath: string): Promise<boolean> {
  const key = repoLockKey(repoPath);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < HAS_REMOTE_TTL_MS) return hit.value;
  let value = false;
  try {
    const r = await run("git", ["remote"], repoPath);
    value = r.code === 0 && r.stdout.trim() !== "";
  } catch {
    value = false; // missing folder: spawn fails on the cwd
  }
  CACHE.set(key, { value, at: Date.now() });
  return value;
}

export function invalidateHasRemote(repoPath?: string): void {
  if (repoPath === undefined) CACHE.clear();
  else CACHE.delete(repoLockKey(repoPath));
}

export type ProjectWithRemote = Project & { hasRemote: boolean };

export async function withHasRemote(project: Project): Promise<ProjectWithRemote> {
  return { ...project, hasRemote: await repoHasRemote(project.repoPath) };
}

export function withHasRemoteAll(projects: Project[]): Promise<ProjectWithRemote[]> {
  return Promise.all(projects.map(withHasRemote));
}
