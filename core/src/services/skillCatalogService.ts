import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InstalledPlugin, SkillCatalogEntry, SkillSource } from "../types/index.js";
import { listInstalled } from "./claudePluginCli.js";
import { errorMessage } from "../utils/error.js";

type CatalogPlugin = Pick<InstalledPlugin, "id" | "installPath" | "enabled">;

export interface SkillCatalogRoots {
  homeDir: string;
  projectRepoPath: string | null;
  listPlugins: () => Promise<CatalogPlugin[]>;
}

interface ResolvedSkill extends SkillCatalogEntry {
  file: string;
}

const PLUGIN_CACHE_TTL_MS = 60_000;
const pluginCache = new Map<string, { at: number; plugins: CatalogPlugin[] }>();

async function listPluginsCached(repoPath: string): Promise<CatalogPlugin[]> {
  const hit = pluginCache.get(repoPath);
  if (hit && Date.now() - hit.at < PLUGIN_CACHE_TTL_MS) return hit.plugins;
  const plugins = await listInstalled(repoPath);
  pluginCache.set(repoPath, { at: Date.now(), plugins });
  return plugins;
}

export function defaultSkillRoots(projectRepoPath: string | null): SkillCatalogRoots {
  return {
    homeDir: os.homedir(),
    projectRepoPath,
    listPlugins: () => (projectRepoPath ? listPluginsCached(projectRepoPath) : Promise.resolve([])),
  };
}

function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/^﻿/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    meta[kv[1]!] = kv[2]!.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return { meta, body: text.slice(match[0].length) };
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function scanSkillsDir(
  dir: string,
  source: SkillSource,
  idPrefix: string,
  pluginId?: string,
): ResolvedSkill[] {
  if (!isDir(dir)) return [];
  const out: ResolvedSkill[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".")) continue;
    const skillDir = path.join(dir, name);
    const file = path.join(skillDir, "SKILL.md");
    if (!isDir(skillDir) || !fs.existsSync(file)) continue;
    let meta: Record<string, string> = {};
    try {
      meta = splitFrontmatter(fs.readFileSync(file, "utf8")).meta;
    } catch {
      continue;
    }
    out.push({
      id: `${idPrefix}:${name}`,
      name: meta.name || name,
      source,
      ...(pluginId ? { pluginId } : {}),
      description: meta.description ?? "",
      file,
    });
  }
  return out;
}

async function resolveCatalog(roots: SkillCatalogRoots): Promise<ResolvedSkill[]> {
  const skills: ResolvedSkill[] = [
    ...scanSkillsDir(path.join(roots.homeDir, ".claude", "skills"), "user", "user"),
  ];
  if (roots.projectRepoPath) {
    skills.push(
      ...scanSkillsDir(path.join(roots.projectRepoPath, ".claude", "skills"), "project", "project"),
    );
  }
  let plugins: CatalogPlugin[] = [];
  try {
    plugins = await roots.listPlugins();
  } catch (err) {
    console.warn(`[skills.catalog] plugin list failed: ${errorMessage(err)}`);
  }
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const pluginName = plugin.id.split("@")[0] ?? plugin.id;
    if (!/^[A-Za-z0-9._-]+$/.test(pluginName)) continue;
    skills.push(
      ...scanSkillsDir(path.join(plugin.installPath, "skills"), "plugin", pluginName, plugin.id),
    );
  }
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

export async function getSkillCatalog(roots: SkillCatalogRoots): Promise<SkillCatalogEntry[]> {
  return (await resolveCatalog(roots)).map(({ file: _file, ...entry }) => entry);
}

export async function readSkillBody(id: string, roots: SkillCatalogRoots): Promise<string | null> {
  const skill = (await resolveCatalog(roots)).find((s) => s.id === id);
  if (!skill) return null;
  try {
    return splitFrontmatter(fs.readFileSync(skill.file, "utf8")).body.trim();
  } catch {
    return null;
  }
}
