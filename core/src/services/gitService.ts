import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_GITIGNORE, DEFAULT_IGNORE_PATTERNS, SHIELD_DIRS } from "./noisePaths.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  cmd: string,
  args: string[],
  cwd: string,
  onLine?: (line: string) => void,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let buffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (!onLine) return;
      buffer += text;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        onLine(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (onLine && buffer.length > 0) onLine(buffer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function runWithProgress(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let outBuf = "";
    let errBuf = "";

    const pump = (chunk: Buffer, which: "out" | "err") => {
      const text = chunk.toString("utf8");
      if (which === "out") stdout += text;
      else stderr += text;
      let buffer = which === "out" ? outBuf + text : errBuf + text;
      let nl: number;
      while ((nl = buffer.search(/\r|\n/)) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) onLine(line);
      }
      if (which === "out") outBuf = buffer;
      else errBuf = buffer;
    };

    child.stdout.on("data", (chunk: Buffer) => pump(chunk, "out"));
    child.stderr.on("data", (chunk: Buffer) => pump(chunk, "err"));
    child.on("error", reject);
    child.on("close", (code) => {
      if (outBuf.length > 0) onLine(outBuf);
      if (errBuf.length > 0) onLine(errBuf);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// ── Stash hygiene (bakim #7, plan §3/9–13) ───────────────────────────────

export const EXCLUDE_BLOCK_START = '# >>> ClauFlow (automatic; see ClauFlow CLAUDE.md "Stash hygiene")';
export const EXCLUDE_BLOCK_END = "# <<< ClauFlow";

/** Absolute path of the repo's `info/exclude` (`--git-path`: right in a worktree too). */
async function excludeFilePath(repoPath: string): Promise<string | null> {
  const r = await run("git", ["rev-parse", "--git-path", "info/exclude"], repoPath);
  if (r.code !== 0) return null;
  const p = r.stdout.trim();
  if (p === "") return null;
  return isAbsolute(p) ? p : resolve(repoPath, p);
}

/**
 * Adds `patterns` to ClauFlow's labelled block in `.git/info/exclude`
 * (created when missing). Lines already present anywhere in the file are
 * skipped; nothing outside the block is changed. Idempotent: a second call
 * writes nothing. Returns the lines it added.
 */
export async function ensureLocalExcludes(repoPath: string, patterns: readonly string[]): Promise<string[]> {
  const file = await excludeFilePath(repoPath);
  if (!file) throw new Error("not a git repository");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = current.split("\n");
  const present = new Set(lines.map((l) => l.trimEnd()));
  const missing = [...new Set(patterns)].filter((p) => !present.has(p));
  if (missing.length === 0) return [];

  const start = lines.indexOf(EXCLUDE_BLOCK_START);
  const end = start === -1 ? -1 : lines.indexOf(EXCLUDE_BLOCK_END, start + 1);
  let next: string;
  if (start !== -1 && end !== -1) {
    next = [...lines.slice(0, end), ...missing, ...lines.slice(end)].join("\n");
  } else {
    const head = current === "" || current.endsWith("\n") ? current : `${current}\n`;
    const gap = head === "" || head.endsWith("\n\n") ? "" : "\n";
    next = `${head}${gap}${[EXCLUDE_BLOCK_START, ...missing, EXCLUDE_BLOCK_END].join("\n")}\n`;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  return missing;
}

/** Escapes gitignore glob characters so a path matches literally. */
function literalPattern(path: string): string {
  return path.replace(/[\\*?[]/g, (c) => `\\${c}`);
}

/**
 * Wholly untracked folders (`?? <dir>/`) whose last segment is in
 * `SHIELD_DIRS`, from a NUL-separated `git status --porcelain=v1 -z`.
 */
export function shieldCandidates(statusZ: string): string[] {
  const entries = statusZ.split("\0");
  const out: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    const path = e.slice(3);
    // Renames/copies carry their source path as the next entry.
    if (xy[0] === "R" || xy[0] === "C") {
      i++;
      continue;
    }
    if (xy !== "??" || !path.endsWith("/")) continue;
    const last = path.slice(0, -1).split("/").pop() ?? "";
    if (SHIELD_DIRS.includes(last)) out.push(path);
  }
  return out;
}

/**
 * The stash "shield" (§3/10): every wholly untracked dependency/build folder
 * in `SHIELD_DIRS` goes to the local exclude block as `/<dir>/`, so a
 * following `git stash push -u` or `git add -A` leaves it where it is.
 * Ambiguous folders (`build/`, `out/`, `target/`, `vendor/`, `.cache/`) and
 * folders holding tracked files are never shielded. Never throws: on any
 * failure it returns `[]` and the run goes on as before. Returns the folders
 * (`node_modules/`) it newly excluded.
 */
export async function shieldNoiseDirs(repoPath: string): Promise<string[]> {
  try {
    const st = await run(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
      repoPath,
    );
    if (st.code !== 0) return [];
    const dirs = shieldCandidates(st.stdout);
    if (dirs.length === 0) return [];
    const added = await ensureLocalExcludes(
      repoPath,
      dirs.map((d) => `/${literalPattern(d)}`),
    );
    const addedSet = new Set(added);
    return dirs.filter((d) => addedSet.has(`/${literalPattern(d)}`));
  } catch {
    return [];
  }
}

/** `[kanban] ignored locally: …` note for a run log, or "" when nothing was shielded. */
export function shieldNote(dirs: readonly string[]): string {
  return dirs.length > 0
    ? `\n[kanban] ignored locally: ${dirs.join(" ")} (added to .git/info/exclude; not stashed, not committed)`
    : "";
}

/**
 * Default ignores for a project's repo (§3/9):
 *  - `isNewRepo` (ClauFlow just ran `git init`): writes `DEFAULT_GITIGNORE`
 *    when the folder has no `.gitignore`; the caller's first commit takes it.
 *  - an existing repo without `.gitignore`: writes no file and commits
 *    nothing; the same patterns go to the local `.git/info/exclude` block.
 *  - a `.gitignore` already exists: nothing.
 */
export async function writeDefaultIgnores(
  repoPath: string,
  opts: { isNewRepo: boolean },
): Promise<"gitignore" | "exclude" | "none"> {
  if (existsSync(join(repoPath, ".gitignore"))) return "none";
  if (opts.isNewRepo) {
    writeFileSync(join(repoPath, ".gitignore"), DEFAULT_GITIGNORE);
    return "gitignore";
  }
  await ensureLocalExcludes(repoPath, DEFAULT_IGNORE_PATTERNS);
  return "exclude";
}

/** `gh` is not on PATH while the repo has a remote (zincir E1, plan §3/21). */
export class GhMissingError extends Error {
  constructor() {
    super("gh_missing");
    this.name = "GhMissingError";
  }
}

/**
 * E1: refresh gh's git credential helper only when the repo has a remote.
 * No remote → `gh` is never spawned. A spawn failure (gh not installed) is
 * `GhMissingError`; a non-zero exit from `gh auth setup-git` is ignored as
 * before.
 */
export async function ensureGhCredentials(repoPath: string): Promise<"skipped" | "ok"> {
  const remotes = await run("git", ["remote"], repoPath);
  if (remotes.stdout.trim() === "") return "skipped";
  try {
    await run("gh", ["auth", "setup-git"], repoPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException | undefined)?.code === "ENOENT") throw new GhMissingError();
    throw e;
  }
  return "ok";
}

/** `checkoutBase` result: `stashed` is the label of the stash it took, if any (zincir E6). */
export interface CheckoutResult extends RunResult {
  stashed?: string;
}

/** `kanban-auto-<taskId>-<iso>` (zincir E6, §3/26); without a task the old `kanban-auto-<iso>`. */
function runStashLabel(prefix: "kanban-auto" | "kanban-pull-auto", taskId?: string): string {
  const iso = new Date().toISOString();
  return taskId ? `${prefix}-${taskId}-${iso}` : `${prefix}-${iso}`;
}

export async function checkoutBase(
  repoPath: string,
  base: string,
  opts: { taskId?: string } = {},
): Promise<CheckoutResult> {
  // Shield (§3/10) before either stash point: wholly untracked dependency/
  // build folders are excluded locally, so the stash below never sweeps them
  // and a tree dirty only with them is not stashed at all.
  const note = shieldNote(await shieldNoiseDirs(repoPath));
  const withNote = <T extends RunResult>(r: T): T => (note ? { ...r, stdout: `${r.stdout}${note}` } : r);

  let co: CheckoutResult = await run("git", ["checkout", base], repoPath);

  // Defensive recovery: if checkout failed because the working tree has
  // local changes that would be overwritten (typically auto-generated SQLite
  // WAL/SHM files left tracked, or other unignored runtime artifacts), stash
  // them with a labeled message and retry. The stash is kept (not popped) so
  // the user can recover real edits later with `git stash list`.
  if (
    co.code !== 0 &&
    /would be overwritten by checkout/i.test(co.stderr + co.stdout)
  ) {
    const label = runStashLabel("kanban-auto", opts.taskId);
    const stash = await run(
      "git",
      ["stash", "push", "--include-untracked", "--message", label],
      repoPath,
    );
    if (stash.code === 0) {
      const retry = await run("git", ["checkout", base], repoPath);
      if (retry.code === 0) {
        retry.stdout = `${retry.stdout}\n[kanban] working tree had dirty files; auto-stashed as "${label}". Recover with: git stash list`;
        co = { ...retry, stashed: label };
      } else {
        return withNote({ ...retry, stashed: label });
      }
    } else {
      return withNote(co);
    }
  }

  if (co.code !== 0) return withNote(co);
  const remotes = await run("git", ["remote"], repoPath);
  const hasRemote = remotes.stdout.trim() !== "";

  // Before stashing, auto-commit a CLAUDE.md the user just saved from the GUI
  // so it does not end up in a stash. Only for repos with a remote (the commit
  // then rides along with the pull); best-effort — failures are not fatal.
  if (hasRemote) {
    const preserveFiles = ["CLAUDE.md"];
    const dirtyPreserve = await run(
      "git",
      ["status", "--porcelain", "--", ...preserveFiles],
      repoPath,
    );
    if (dirtyPreserve.code === 0 && dirtyPreserve.stdout.trim() !== "") {
      const add = await run("git", ["add", "--", ...preserveFiles], repoPath);
      if (add.code === 0) {
        await run(
          "git",
          ["commit", "-m", "chore: autosave CLAUDE.md"],
          repoPath,
        );
      }
    }
  }

  // A5: `git checkout` carries uncommitted edits over to base, and the new task
  // branch would then commit them. Stash anything left over — with or without
  // a remote — under a labeled message so real edits stay recoverable via
  // `git stash list`. (With a remote this also keeps `git pull` from failing
  // on a dirty tree under `pull.rebase = true`.)
  const dirty = await run("git", ["status", "--porcelain"], repoPath);
  let stashLabel: string | null = null;
  if (dirty.stdout.trim() !== "") {
    stashLabel = runStashLabel(hasRemote ? "kanban-pull-auto" : "kanban-auto", opts.taskId);
    const stash = await run(
      "git",
      ["stash", "push", "--include-untracked", "--message", stashLabel],
      repoPath,
    );
    if (stash.code !== 0) return withNote(stash);
  }
  const stashNote = stashLabel
    ? `\n[kanban] working tree had dirty files; auto-stashed as "${stashLabel}". Recover with: git stash list`
    : "";

  // Either stash point may have fired; report the latest label.
  const stashed = stashLabel ?? co.stashed;
  const withStash = stashed ? { stashed } : {};
  if (!hasRemote) return { ...co, stdout: `${co.stdout}${stashNote}${note}`, ...withStash };

  const pullResult = await run("git", ["pull", "origin", base], repoPath);
  if (pullResult.code !== 0) return withNote({ ...pullResult, ...withStash });
  return {
    code: 0,
    stdout: `${co.stdout}\n${pullResult.stdout}${stashNote}${note}`,
    stderr: pullResult.stderr,
    ...withStash,
  };
}

export function createBranch(repoPath: string, branch: string): Promise<RunResult> {
  return run("git", ["checkout", "-b", branch], repoPath);
}

export async function commitAll(repoPath: string, message: string): Promise<RunResult> {
  // Shield (§3/10): an untracked `node_modules/` (e.g. the agent's `npm
  // install`) is excluded locally instead of being committed.
  await shieldNoiseDirs(repoPath);
  const add = await run("git", ["add", "-A"], repoPath);
  if (add.code !== 0) return add;
  return run("git", ["commit", "-m", message], repoPath);
}

/**
 * A6: `--force-with-lease` so a retry that recreated the task branch can push
 * over the previous attempt's branch (e.g. push succeeded, `gh pr create`
 * failed), while still refusing to clobber commits someone else pushed.
 */
export function pushBranch(repoPath: string, branch: string): Promise<RunResult> {
  return run("git", ["push", "--force-with-lease", "-u", "origin", "--", branch], repoPath);
}

interface CreatePrInput {
  repoPath: string;
  title: string;
  body: string;
  base: string;
}

interface PrResult {
  url: string | null;
  number: number | null;
  raw: RunResult;
}

export async function initRepo(repoPath: string, branch?: string): Promise<RunResult> {
  return run("git", branch ? ["init", "-b", branch] : ["init"], repoPath);
}

export async function createGithubRepo(
  repoPath: string,
  repoName: string,
  isPrivate: boolean,
): Promise<RunResult> {
  return run(
    "gh",
    ["repo", "create", repoName, isPrivate ? "--private" : "--public", "--source=.", "--push"],
    repoPath,
  );
}

export async function getRemoteUrl(repoPath: string): Promise<string | null> {
  const result = await run("git", ["remote", "get-url", "origin"], repoPath);
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function mergePr(
  repoPath: string,
  prNumber: number,
): Promise<RunResult> {
  return run(
    "gh",
    ["pr", "merge", String(prNumber), "--merge", "--delete-branch"],
    repoPath,
  );
}

export async function createPr(input: CreatePrInput): Promise<PrResult> {
  const raw = await run(
    "gh",
    [
      "pr",
      "create",
      "--title",
      input.title,
      "--body",
      input.body,
      "--base",
      input.base,
    ],
    input.repoPath,
  );
  if (raw.code !== 0) {
    // PR already exists — extract URL from the error message and treat as success.
    const existing = (raw.stderr + raw.stdout).match(/already exists:\s*(https:\/\/\S+)/);
    if (existing?.[1]) {
      const url = existing[1];
      const match = url.match(/\/pull\/(\d+)/);
      const number = match?.[1] ? Number(match[1]) : null;
      return { url, number, raw };
    }
    return { url: null, number: null, raw };
  }
  const url = raw.stdout.trim().split(/\s+/).find((s) => s.startsWith("http")) ?? null;
  const match = url?.match(/\/pull\/(\d+)/);
  const number = match && match[1] ? Number(match[1]) : null;
  return { url, number, raw };
}
