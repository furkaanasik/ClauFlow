import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_CLAUDE = fileURLToPath(
  new URL("../agents/__fixtures__/fake-claude.mjs", import.meta.url),
);

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Temp git repo on `main` with one commit, local identity, and no remote. */
export function makeRepo(prefix = "clauflow-team-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "fake@clauflow.test");
  git(dir, "config", "user.name", "ClauFlow Test");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "# fake repo\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export function writeRepoFile(repo: string, rel: string, body: string): void {
  const file = join(repo, rel);
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

export interface FakeCall {
  cwd: string;
  role: string | null;
  round: number;
  prompt: string;
  model: string | null;
  tools: string | null;
  advisor: string | null;
  appendSystemPrompt: string | null;
  settingSources: string | null;
  strictMcpConfig: boolean;
  allowedTools?: string | null;
  outputFormat?: string;
  permissionMode?: string | null;
  argv: string[];
}

export function readCalls(stateDir: string): FakeCall[] {
  const file = join(stateDir, "calls.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FakeCall);
}
