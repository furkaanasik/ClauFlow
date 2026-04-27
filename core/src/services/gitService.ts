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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function branchName(taskId: string, title: string): string {
  const slug = slugify(title) || "task";
  return `feature/task-${taskId}-${slug}`;
}

export async function checkoutBase(repoPath: string, base: string): Promise<RunResult> {
  const co = await run("git", ["checkout", base], repoPath);
  if (co.code !== 0) return co;
  // Pull only when a remote exists — skip silently for local-only repos
  const remotes = await run("git", ["remote"], repoPath);
  if (remotes.stdout.trim() === "") return { code: 0, stdout: "", stderr: "" };
  return run("git", ["pull", "origin", base], repoPath);
}

export function createBranch(repoPath: string, branch: string): Promise<RunResult> {
  return run("git", ["checkout", "-b", branch], repoPath);
}

export async function commitAll(repoPath: string, message: string): Promise<RunResult> {
  const add = await run("git", ["add", "-A"], repoPath);
  if (add.code !== 0) return add;
  return run("git", ["commit", "-m", message], repoPath);
}

export function pushBranch(repoPath: string, branch: string): Promise<RunResult> {
  return run("git", ["push", "-u", "origin", branch], repoPath);
}

export interface CreatePrInput {
  repoPath: string;
  title: string;
  body: string;
  base: string;
}

export interface PrResult {
  url: string | null;
  number: number | null;
  raw: RunResult;
}

export interface PushAndPrInput {
  repoPath: string;
  branch: string;
  base: string;
  prTitle: string;
  prBody: string;
  commitMessage: string;
}

export interface PushAndPrResult {
  push: RunResult;
  pr: PrResult | null;
  commit: RunResult;
}

export async function pushAndPR(input: PushAndPrInput): Promise<PushAndPrResult> {
  const commit = await commitAll(input.repoPath, input.commitMessage);
  if (commit.code !== 0) {
    return { commit, push: { code: -1, stdout: "", stderr: "commit failed" }, pr: null };
  }
  const push = await pushBranch(input.repoPath, input.branch);
  if (push.code !== 0) return { commit, push, pr: null };
  const pr = await createPr({
    repoPath: input.repoPath,
    title: input.prTitle,
    body: input.prBody,
    base: input.base,
  });
  return { commit, push, pr };
}

export async function initRepo(repoPath: string): Promise<RunResult> {
  return run("git", ["init"], repoPath);
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

export async function deleteGithubRepo(remoteUrl: string): Promise<RunResult> {
  const match = remoteUrl.match(
    /(?:github\.com[/:])([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (!match || !match[1] || !match[2]) {
    throw new Error(`invalid GitHub remote URL: ${remoteUrl}`);
  }
  const owner = match[1];
  const repo = match[2];
  const result = await run("gh", ["repo", "delete", `${owner}/${repo}`, "--yes"], process.cwd());
  if (result.code !== 0) {
    const output = `${result.stderr}\n${result.stdout}`;
    if (/delete_repo/i.test(output)) {
      throw new Error(
        `GitHub silme yetkisi yok. Terminalde şu komutu çalıştırıp tekrar deneyin:\n\ngh auth refresh -h github.com -s delete_repo`,
      );
    }
    if (/HTTP 404|Not Found/i.test(output)) {
      throw new Error(
        `Repo GitHub'da bulunamadı (${owner}/${repo}). Zaten silinmiş olabilir — local kayıttan kaldırmak için "Kanban'dan Sil" kullanabilirsiniz.`,
      );
    }
    throw new Error(
      `gh repo delete failed: ${result.stderr || result.stdout}`.trim(),
    );
  }
  return result;
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
  if (raw.code !== 0) return { url: null, number: null, raw };
  const url = raw.stdout.trim().split(/\s+/).find((s) => s.startsWith("http")) ?? null;
  const match = url?.match(/\/pull\/(\d+)/);
  const number = match && match[1] ? Number(match[1]) : null;
  return { url, number, raw };
}
