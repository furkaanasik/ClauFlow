import { spawn } from "node:child_process";

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

export async function checkoutBase(repoPath: string, base: string): Promise<RunResult> {
  let co = await run("git", ["checkout", base], repoPath);

  // Defensive recovery: if checkout failed because the working tree has
  // local changes that would be overwritten (typically auto-generated SQLite
  // WAL/SHM files left tracked, or other unignored runtime artifacts), stash
  // them with a labeled message and retry. The stash is kept (not popped) so
  // the user can recover real edits later with `git stash list`.
  if (
    co.code !== 0 &&
    /would be overwritten by checkout/i.test(co.stderr + co.stdout)
  ) {
    const label = `kanban-auto-${new Date().toISOString()}`;
    const stash = await run(
      "git",
      ["stash", "push", "--include-untracked", "--message", label],
      repoPath,
    );
    if (stash.code === 0) {
      const retry = await run("git", ["checkout", base], repoPath);
      if (retry.code === 0) {
        retry.stdout = `${retry.stdout}\n[kanban] working tree had dirty files; auto-stashed as "${label}". Recover with: git stash list`;
        co = retry;
      } else {
        return retry;
      }
    } else {
      return co;
    }
  }

  if (co.code !== 0) return co;
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
    stashLabel = `${hasRemote ? "kanban-pull-auto" : "kanban-auto"}-${new Date().toISOString()}`;
    const stash = await run(
      "git",
      ["stash", "push", "--include-untracked", "--message", stashLabel],
      repoPath,
    );
    if (stash.code !== 0) return stash;
  }
  const stashNote = stashLabel
    ? `\n[kanban] working tree had dirty files; auto-stashed as "${stashLabel}". Recover with: git stash list`
    : "";

  if (!hasRemote) return { ...co, stdout: `${co.stdout}${stashNote}` };

  const pullResult = await run("git", ["pull", "origin", base], repoPath);
  if (pullResult.code !== 0) return pullResult;
  return {
    code: 0,
    stdout: `${co.stdout}\n${pullResult.stdout}${stashNote}`,
    stderr: pullResult.stderr,
  };
}

export function createBranch(repoPath: string, branch: string): Promise<RunResult> {
  return run("git", ["checkout", "-b", branch], repoPath);
}

export async function commitAll(repoPath: string, message: string): Promise<RunResult> {
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
