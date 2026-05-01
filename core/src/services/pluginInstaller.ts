import fs from "node:fs";
import path from "node:path";
import { run } from "./gitService.js";
import {
  pluginPath,
  pluginsDir,
  upsertPlugin,
  type PluginEntry,
} from "./pluginManager.js";
import type { SkillEntry } from "./pluginRegistry.js";

export type InstallPhase = "cloning" | "enabling" | "done" | "error";

export interface InstallProgressEvent {
  status: InstallPhase;
  message: string;
}

export interface InstallResult {
  success: boolean;
  plugin: PluginEntry | null;
  error: string | null;
}

export async function installPlugin(
  repoPath: string,
  skill: SkillEntry,
  onProgress: (event: InstallProgressEvent) => void,
): Promise<InstallResult> {
  if (!fs.existsSync(repoPath)) {
    const message = `repo path does not exist: ${repoPath}`;
    onProgress({ status: "error", message });
    return { success: false, plugin: null, error: message };
  }

  const targetDir = pluginPath(repoPath, skill.slug);
  if (fs.existsSync(targetDir)) {
    const message = `plugin already installed at ${targetDir}`;
    onProgress({ status: "error", message });
    return { success: false, plugin: null, error: message };
  }

  fs.mkdirSync(pluginsDir(repoPath), { recursive: true });

  onProgress({ status: "cloning", message: `git clone ${skill.repoUrl}` });
  const args = ["clone", "--depth", "1"];
  if (skill.version && skill.version !== "main") {
    args.push("--branch", skill.version);
  }
  args.push("--", skill.repoUrl, targetDir);
  const clone = await run("git", args, repoPath, (line) => {
    if (line.trim().length > 0) {
      onProgress({ status: "cloning", message: line });
    }
  });

  if (clone.code !== 0) {
    const message = `git clone failed: ${clone.stderr || clone.stdout}`.trim();
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    onProgress({ status: "error", message });
    return { success: false, plugin: null, error: message };
  }

  onProgress({ status: "enabling", message: "writing settings.json" });
  const entry: PluginEntry = {
    slug: skill.slug,
    enabled: true,
    source: "project",
    repoUrl: skill.repoUrl,
    version: skill.version,
    path: path.join(".claude", "plugins", skill.slug),
  };

  try {
    upsertPlugin(repoPath, entry);
  } catch (err) {
    const message = `failed to update settings.json: ${(err as Error).message}`;
    onProgress({ status: "error", message });
    return { success: false, plugin: null, error: message };
  }

  onProgress({ status: "done", message: `installed ${skill.slug}` });
  return { success: true, plugin: entry, error: null };
}
