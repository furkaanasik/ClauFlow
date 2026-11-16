import { lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./gitService.js";
import { classifyPath, noiseRoot, type PathClass } from "./noisePaths.js";
import { tryAcquireRepoLock } from "./repoLock.js";
import { DIFF_CHAR_CAP } from "./taskDiff.js";
import { getTaskSync } from "./taskService.js";
import { getComment } from "./commentService.js";

/**
 * zincir E6 (plan §3/26–27, §5.9): the stashes ClauFlow took, read straight
 * from `git stash list` (git is the single source of truth; no table). Only
 * ClauFlow labels are listed and only those can be restored or dropped — the
 * user's own stashes are never touched. Endpoints address a stash by its
 * commit SHA (`stash@{n}` indices shift); the index is resolved under the
 * repo lock at operation time.
 */

export type StashReason = "run" | "merge" | "comment" | "resolve";

export interface StashEntry {
  /** Stash commit SHA (`%H`). */
  ref: string;
  label: string;
  reason: StashReason;
  taskId: string | null;
  displayId: string | null;
  /** ISO time the stash was taken (`%ct`). */
  createdAt: string;
  /** Files in the stash (tracked + untracked), at most `MAX_FILES`. */
  files: string[];
  /** Class counts (bakim #6, §3/15). */
  summary: StashSummary;
  /** No file in the `code` class: dropping loses nothing the user wrote. */
  safeToDrop: boolean;
}

/** `U` = untracked (from the stash's third parent). */
export type StashFileStatus = "M" | "A" | "D" | "T" | "U";

export interface StashFile {
  path: string;
  status: StashFileStatus;
  class: PathClass;
}

export interface StashSummary {
  total: number;
  deps: number;
  build: number;
  lockOs: number;
  code: number;
  untracked: number;
}

/** Noise files folded under their noise root (or code overflow under its top folder). */
export interface StashGroup {
  root: string;
  class: PathClass;
  count: number;
  /** At most `GROUP_SAMPLE` paths, sorted. */
  sample: string[];
}

export interface StashDetail {
  ref: string;
  label: string;
  summary: StashSummary;
  safeToDrop: boolean;
  codeFiles: StashFile[];
  lockOsFiles: StashFile[];
  groups: StashGroup[];
  /** Some code/lock files did not fit the per-file lists (they are in `groups`). */
  truncated: boolean;
}

export interface ParsedStashLabel {
  reason: StashReason;
  taskId?: string;
  commentId?: string;
}

export type StashErrorCode =
  | "repo_busy"
  | "stash_not_found"
  | "worktree_dirty"
  | "stash_conflict"
  | "stash_file_not_found"
  | "stash_file_deleted";

export class StashError extends Error {
  readonly code: StashErrorCode;
  readonly extra: { files?: string[]; detail?: string };
  constructor(code: StashErrorCode, extra: { files?: string[]; detail?: string } = {}) {
    super(code);
    this.name = "StashError";
    this.code = code;
    this.extra = extra;
  }
}

const MAX_FILES = 20;
const ISO_TAIL = /^(?:(.+)-)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/;

/**
 * Recognises ClauFlow's stash labels (pure):
 * - `kanban-auto-<iso>` / `kanban-pull-auto-<iso>` (old run label, no task) and
 *   `kanban-auto-<taskId>-<iso>` / `kanban-pull-auto-<taskId>-<iso>` → `run`;
 * - `clauflow-merge-<taskId>` → `merge`;
 * - `clauflow-comment-<commentId>` → `comment`;
 * - `clauflow-resolve-<taskId>` → `resolve` (F4.6 conflict resolver, §3/40).
 * `clauflow-discard-*` (a run's own throwaway stashes) and anything else → null.
 */
export function parseStashLabel(label: string): ParsedStashLabel | null {
  const s = label.trim();
  const runMatch = /^kanban-(?:pull-)?auto-(.+)$/.exec(s);
  if (runMatch) {
    const tail = ISO_TAIL.exec(runMatch[1]!);
    if (tail?.[1]) return { reason: "run", taskId: tail[1] };
    return { reason: "run" };
  }
  const cf = /^clauflow-(merge|comment|resolve)-(\S+)$/.exec(s);
  if (!cf) return null;
  const kind = cf[1] as "merge" | "comment" | "resolve";
  const id = cf[2]!;
  return kind === "comment" ? { reason: "comment", commentId: id } : { reason: kind, taskId: id };
}

/** `On main: <label>` / `WIP on main: …` → `<label>`. */
function labelFromSubject(subject: string): string {
  const m = /^(?:WIP on|On) [^:]+: (.*)$/.exec(subject);
  return (m ? m[1]! : subject).trim();
}

interface RawStash {
  index: string; // stash@{n}
  sha: string;
  createdAt: string;
  label: string;
  parsed: ParsedStashLabel;
}

async function readClauflowStashes(repo: string): Promise<RawStash[]> {
  let list;
  try {
    list = await run("git", ["stash", "list", "--format=%gd%x09%H%x09%ct%x09%s"], repo);
  } catch {
    return []; // repo path missing
  }
  if (list.code !== 0) return []; // not a git repo
  const out: RawStash[] = [];
  for (const line of list.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [index, sha, ct, ...rest] = line.split("\t");
    if (!index || !sha || !ct) continue;
    const label = labelFromSubject(rest.join("\t"));
    const parsed = parseStashLabel(label);
    if (!parsed) continue;
    out.push({ index, sha, createdAt: new Date(Number(ct) * 1000).toISOString(), label, parsed });
  }
  return out;
}

async function stashFiles(repo: string, sha: string): Promise<string[]> {
  const show = await run(
    "git",
    ["stash", "show", "--name-only", "--include-untracked", sha],
    repo,
  );
  if (show.code !== 0) return [];
  return show.stdout
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .slice(0, MAX_FILES);
}

function taskIdOf(parsed: ParsedStashLabel): string | null {
  if (parsed.taskId) return parsed.taskId;
  if (parsed.commentId) {
    try {
      return getComment(parsed.commentId)?.taskId ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** ClauFlow's stashes in `repo`, newest first. Missing repo / not git → []. */
export async function listClauflowStashes(repo: string): Promise<StashEntry[]> {
  const raw = await readClauflowStashes(repo);
  const entries: StashEntry[] = [];
  for (const r of raw) {
    const taskId = taskIdOf(r.parsed);
    let displayId: string | null = null;
    if (taskId) {
      try {
        displayId = getTaskSync(taskId)?.displayId ?? null;
      } catch {
        displayId = null;
      }
    }
    const files = await stashFileMap(repo, r.sha);
    const summary = summarize(files);
    entries.push({
      ref: r.sha,
      label: r.label,
      reason: r.parsed.reason,
      taskId,
      displayId,
      createdAt: r.createdAt,
      files: await stashFiles(repo, r.sha),
      summary,
      safeToDrop: summary.code === 0,
    });
  }
  return entries;
}

async function resolveStash(repo: string, sha: string): Promise<RawStash> {
  const found = (await readClauflowStashes(repo)).find((r) => r.sha === sha.toLowerCase());
  if (!found) throw new StashError("stash_not_found");
  return found;
}

function outText(r: { stdout: string; stderr: string }): string {
  return (r.stderr.trim() || r.stdout.trim()).slice(0, 2000);
}

/**
 * Applies a ClauFlow stash onto a clean tree and drops it (§3/27). Never
 * waits for the lock (`repo_busy`). A conflicting apply puts the tree back to
 * its clean state and keeps the stash (`stash_conflict` + files).
 */
export async function restoreStash(
  repo: string,
  sha: string,
): Promise<{ restored: string; branch: string | null }> {
  const lease = tryAcquireRepoLock(repo, `stash:restore:${sha.slice(0, 12)}`);
  if (!lease) throw new StashError("repo_busy");
  try {
    const stash = await resolveStash(repo, sha);
    const status = await run("git", ["status", "--porcelain"], repo);
    if (status.code !== 0 || status.stdout.trim() !== "") throw new StashError("worktree_dirty");

    let apply = await run("git", ["stash", "apply", "--index", stash.sha], repo);
    if (apply.code !== 0) {
      // `--index` can refuse up front (index conflicts) without touching the
      // tree; only then is a plain apply worth one more try.
      const after = await run("git", ["status", "--porcelain"], repo);
      if (after.code === 0 && after.stdout.trim() === "") {
        apply = await run("git", ["stash", "apply", stash.sha], repo);
      }
    }
    if (apply.code !== 0) {
      const unmerged = await run("git", ["diff", "--name-only", "--diff-filter=U"], repo);
      const files = unmerged.stdout.split("\n").map((f) => f.trim()).filter(Boolean);
      // The tree was verified clean before the apply, so this only removes
      // what the failed apply brought in.
      await run("git", ["reset", "--hard", "HEAD"], repo);
      await run("git", ["clean", "-fd"], repo);
      throw new StashError("stash_conflict", { files, detail: outText(apply) });
    }

    // Indices may have moved since the lookup only if someone else touched
    // the stash list; resolve again right before dropping.
    const current = await resolveStash(repo, stash.sha).catch(() => null);
    if (current) await run("git", ["stash", "drop", current.index], repo);
    const head = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], repo);
    return { restored: stash.label, branch: head.code === 0 ? head.stdout.trim() : null };
  } finally {
    lease.release();
  }
}

/** Drops one ClauFlow stash by SHA (same lock rule as restore). */
export async function dropStash(repo: string, sha: string): Promise<{ dropped: string }> {
  const lease = tryAcquireRepoLock(repo, `stash:drop:${sha.slice(0, 12)}`);
  if (!lease) throw new StashError("repo_busy");
  try {
    const stash = await resolveStash(repo, sha);
    const drop = await run("git", ["stash", "drop", stash.index], repo);
    if (drop.code !== 0) throw new StashError("stash_not_found", { detail: outText(drop) });
    return { dropped: stash.label };
  } finally {
    lease.release();
  }
}

// ── bakim #6: stash detail, per-file diff and restore (plan §3/14–18, §5.4) ──

/** Code files listed one by one before the rest fold into folder groups. */
const CODE_LIST_CAP = 500;
const GROUP_SAMPLE = 200;
const CACHE_MAX = 20;

/** Every file of a stash by path. A stash commit never changes: cached by SHA. */
const fileCache = new Map<string, Map<string, StashFile>>();

function cachePut(sha: string, files: Map<string, StashFile>): void {
  fileCache.delete(sha);
  fileCache.set(sha, files);
  while (fileCache.size > CACHE_MAX) {
    const oldest = fileCache.keys().next().value as string;
    fileCache.delete(oldest);
  }
}

/** Test hook: forget cached stash file lists. */
export function clearStashDetailCache(): void {
  fileCache.clear();
}

function toStatus(letter: string): StashFileStatus {
  return letter === "A" || letter === "D" || letter === "T" ? letter : "M";
}

/**
 * All files of a stash: tracked changes (`<sha>^1..<sha>`, renames off) and,
 * when the stash has a third parent, its untracked files (`U`).
 */
async function stashFileMap(repo: string, sha: string): Promise<Map<string, StashFile>> {
  const hit = fileCache.get(sha);
  if (hit) return hit;
  const files = new Map<string, StashFile>();
  const tracked = await run(
    "git",
    ["diff", "--name-status", "-z", "--no-renames", `${sha}^1`, sha],
    repo,
  );
  if (tracked.code === 0) {
    const parts = tracked.stdout.split("\0");
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const letter = parts[i]!.trim();
      const path = parts[i + 1]!;
      if (!letter || !path) continue;
      files.set(path, { path, status: toStatus(letter[0]!), class: classifyPath(path) });
    }
  }
  const third = await run("git", ["rev-parse", "-q", "--verify", `${sha}^3`], repo);
  if (third.code === 0) {
    const untracked = await run("git", ["ls-tree", "-r", "-z", "--name-only", `${sha}^3`], repo);
    if (untracked.code === 0) {
      for (const path of untracked.stdout.split("\0")) {
        if (!path) continue;
        files.set(path, { path, status: "U", class: classifyPath(path) });
      }
    }
  }
  cachePut(sha, files);
  return files;
}

function summarize(files: Map<string, StashFile>): StashSummary {
  const s: StashSummary = { total: 0, deps: 0, build: 0, lockOs: 0, code: 0, untracked: 0 };
  for (const f of files.values()) {
    s.total += 1;
    if (f.class === "deps") s.deps += 1;
    else if (f.class === "build") s.build += 1;
    else if (f.class === "lock_os") s.lockOs += 1;
    else s.code += 1;
    if (f.status === "U") s.untracked += 1;
  }
  return s;
}

const byPath = (a: StashFile, b: StashFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Top folder of a path (`src/a/b.ts` → `src/`), or `./` for a root file. */
function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "./" : path.slice(0, i + 1);
}

function buildDetail(stash: RawStash, files: Map<string, StashFile>): StashDetail {
  const summary = summarize(files);
  const sorted = [...files.values()].sort(byPath);
  const codeAll = sorted.filter((f) => f.class === "code");
  const lockAll = sorted.filter((f) => f.class === "lock_os");
  const groups = new Map<string, { root: string; class: PathClass; paths: string[] }>();
  const addToGroup = (root: string, cls: PathClass, path: string) => {
    const key = `${cls}\0${root}`;
    const g = groups.get(key) ?? { root, class: cls, paths: [] };
    g.paths.push(path);
    groups.set(key, g);
  };
  for (const f of sorted) {
    if (f.class === "deps" || f.class === "build") addToGroup(noiseRoot(f.path) ?? f.path, f.class, f.path);
  }
  const overflow = [...codeAll.slice(CODE_LIST_CAP), ...lockAll.slice(CODE_LIST_CAP)];
  for (const f of overflow) addToGroup(topFolder(f.path), f.class, f.path);
  return {
    ref: stash.sha,
    label: stash.label,
    summary,
    safeToDrop: summary.code === 0,
    codeFiles: codeAll.slice(0, CODE_LIST_CAP),
    lockOsFiles: lockAll.slice(0, CODE_LIST_CAP),
    groups: [...groups.values()]
      .map((g) => ({ root: g.root, class: g.class, count: g.paths.length, sample: g.paths.slice(0, GROUP_SAMPLE) }))
      .sort((a, b) => b.count - a.count || (a.root < b.root ? -1 : 1)),
    truncated: overflow.length > 0,
  };
}

/** File list, class counts and noise groups of one ClauFlow stash (`stash_not_found`). */
export async function getStashDetail(repo: string, sha: string): Promise<StashDetail> {
  const stash = await resolveStash(repo, sha);
  return buildDetail(stash, await stashFileMap(repo, stash.sha));
}

async function stashFile(repo: string, sha: string, path: string): Promise<{ stash: RawStash; file: StashFile }> {
  const stash = await resolveStash(repo, sha);
  const file = (await stashFileMap(repo, stash.sha)).get(path);
  if (!file) throw new StashError("stash_file_not_found");
  return { stash, file };
}

let emptyTreeId: string | null = null;

/** The empty tree's id in this repo's hash (sha1/sha256). */
async function emptyTree(repo: string): Promise<string> {
  if (emptyTreeId) return emptyTreeId;
  const r = await run("git", ["hash-object", "-t", "tree", "/dev/null"], repo);
  const id = r.stdout.trim();
  if (r.code !== 0 || !id) throw new Error(`git hash-object failed: ${outText(r)}`);
  if (id.length === 40) emptyTreeId = id; // sha256 repos are rare: not cached
  return id;
}

/**
 * Unified diff of one stash file (§3/17), only for a path in that stash's
 * list (`stash_file_not_found`). Tracked: `<sha>^1..<sha>`; untracked: the
 * empty tree against `<sha>^3`. Capped at `DIFF_CHAR_CAP`.
 */
export async function getStashFileDiff(
  repo: string,
  sha: string,
  path: string,
): Promise<{ path: string; status: StashFileStatus; diff: string; truncated: boolean }> {
  const { stash, file } = await stashFile(repo, sha, path);
  const range =
    file.status === "U" ? [await emptyTree(repo), `${stash.sha}^3`] : [`${stash.sha}^1`, stash.sha];
  const r = await run(
    "git",
    ["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", ...range, "--", path],
    repo,
  );
  if (r.code !== 0) throw new Error(`git diff failed: ${outText(r)}`);
  const truncated = r.stdout.length > DIFF_CHAR_CAP;
  return { path, status: file.status, diff: truncated ? r.stdout.slice(0, DIFF_CHAR_CAP) : r.stdout, truncated };
}

function lstatKind(abs: string): "file" | "dir" | null {
  try {
    return lstatSync(abs).isDirectory() ? "dir" : "file";
  } catch {
    return null;
  }
}

/**
 * Restores one file of a ClauFlow stash (§3/18) without dropping the stash.
 * Never waits for the lock (`repo_busy`). Only that path must be clean
 * (ignored copies count as dirty: they would be overwritten): otherwise
 * `worktree_dirty` + files. A path that collides with a folder (or whose
 * parent is a file) is `stash_conflict` and nothing is touched. The index is
 * left as it was (`git reset -q -- <path>`), so the file shows as modified or
 * untracked. A deleted (`D`) file cannot be restored (`stash_file_deleted`).
 */
export async function restoreStashFile(
  repo: string,
  sha: string,
  path: string,
): Promise<{ restored: string; branch: string | null }> {
  const lease = tryAcquireRepoLock(repo, `stash:restore-file:${sha.slice(0, 12)}`);
  if (!lease) throw new StashError("repo_busy");
  try {
    const { stash, file } = await stashFile(repo, sha, path);
    if (file.status === "D") throw new StashError("stash_file_deleted", { files: [path] });

    const status = await run(
      "git",
      ["--literal-pathspecs", "status", "--porcelain", "--ignored", "--", path],
      repo,
    );
    if (status.code !== 0 || status.stdout.trim() !== "") {
      throw new StashError("worktree_dirty", { files: [path] });
    }

    // A folder where the file goes, or a file where a parent folder goes:
    // `git checkout` would silently replace it, so refuse up front.
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) {
      if (lstatKind(join(repo, ...segments.slice(0, i))) === "file") {
        throw new StashError("stash_conflict", { files: [path], detail: "parent is a file" });
      }
    }
    const before = lstatKind(join(repo, path));
    if (before === "dir") throw new StashError("stash_conflict", { files: [path], detail: "path is a folder" });

    const source = file.status === "U" ? `${stash.sha}^3` : stash.sha;
    const co = await run("git", ["--literal-pathspecs", "checkout", source, "--", path], repo);
    await run("git", ["--literal-pathspecs", "reset", "-q", "--", path], repo);
    if (co.code !== 0) {
      // Put the path back the way it was (it was clean before).
      const inHead = await run("git", ["cat-file", "-e", `HEAD:${path}`], repo);
      if (inHead.code === 0) {
        await run("git", ["--literal-pathspecs", "checkout", "HEAD", "--", path], repo);
      } else if (before === null && lstatKind(join(repo, path)) === "file") {
        unlinkSync(join(repo, path));
      }
      throw new StashError("stash_conflict", { files: [path], detail: outText(co) });
    }
    const head = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], repo);
    return { restored: path, branch: head.code === 0 ? head.stdout.trim() : null };
  } finally {
    lease.release();
  }
}
