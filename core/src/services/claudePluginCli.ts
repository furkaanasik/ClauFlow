import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InstalledPlugin } from "../types/index.js";
import { errorMessage } from "../utils/error.js";

const TIMEOUT_MS = 60_000;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runClaude(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      console.error("[claudePluginCli] timed out", args);
      reject(new Error("claude plugin command timed out"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function runOrThrow(args: string[], cwd: string): Promise<string> {
  const result = await runClaude(args, cwd);
  if (result.code !== 0) {
    const message = (result.stderr || result.stdout).trim() || `claude ${args.join(" ")} exited with code ${result.code}`;
    throw new Error(message);
  }
  return result.stdout;
}

function parseJson<T>(raw: string, label: string): T {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${label}: empty stdout`);
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    throw new Error(`${label}: failed to parse JSON: ${errorMessage(err)}`);
  }
}

export async function listInstalled(repoPath: string): Promise<InstalledPlugin[]> {
  const out = await runOrThrow(["plugin", "list", "--json"], repoPath);
  const parsed = parseJson<unknown>(out, "claude plugin list");
  if (Array.isArray(parsed)) return parsed as InstalledPlugin[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { installed?: unknown }).installed)) {
    return (parsed as { installed: InstalledPlugin[] }).installed;
  }
  return [];
}

export async function uninstallPlugin(
  repoPath: string,
  pluginId: string,
  scope: "user" | "project" | "local",
): Promise<void> {
  const scopes: Array<"user" | "project" | "local"> = Array.from(
    new Set([scope, "local", "project", "user"]),
  );
  let lastErr: unknown;
  let succeeded = false;
  for (const s of scopes) {
    try {
      await runOrThrow(["plugin", "uninstall", pluginId, "--scope", s, "-y"], repoPath);
      succeeded = true;
      break;
    } catch (err) {
      lastErr = err;
      const msg = errorMessage(err).toLowerCase();
      if (!msg.includes("not found")) throw err;
    }
  }
  await cleanupOrphanCache(pluginId);
  if (!succeeded) throw lastErr ?? new Error(`plugin ${pluginId} not found in any scope`);
}

export async function cleanupOrphanCache(pluginId: string): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+$/.test(pluginId)) return;
  const cacheDir = join(homedir(), ".claude", "plugins", "cache", pluginId);
  try {
    await rm(cacheDir, { recursive: true, force: true });
  } catch (err) {
    console.error("[claudePluginCli] cache cleanup failed", pluginId, errorMessage(err));
  }
}

export async function enablePlugin(
  repoPath: string,
  pluginId: string,
  scope: "user" | "project" | "local",
): Promise<void> {
  await runOrThrow(["plugin", "enable", pluginId, "--scope", scope], repoPath);
}

export async function disablePlugin(
  repoPath: string,
  pluginId: string,
  scope: "user" | "project" | "local",
): Promise<void> {
  await runOrThrow(["plugin", "disable", pluginId, "--scope", scope], repoPath);
}
