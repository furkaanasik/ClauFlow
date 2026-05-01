import fs from "node:fs";
import path from "node:path";

export interface PluginEntry {
  slug: string;
  enabled: boolean;
  source: "git";
  repoUrl: string;
  version: string;
  path: string;
}

export interface InstalledPlugin extends PluginEntry {
  directoryExists: boolean;
}

interface SettingsShape {
  env?: Record<string, string>;
  permissions?: Record<string, unknown>;
  plugins?: PluginEntry[];
  [k: string]: unknown;
}

export function pluginsDir(repoPath: string): string {
  return path.join(repoPath, ".claude", "plugins");
}

export function pluginPath(repoPath: string, slug: string): string {
  return path.join(pluginsDir(repoPath), slug);
}

export function settingsFilePath(repoPath: string): string {
  return path.join(repoPath, ".claude", "settings.json");
}

export function readSettings(repoPath: string): SettingsShape {
  const file = settingsFilePath(repoPath);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SettingsShape;
    }
  } catch {
    // fall through
  }
  return {};
}

export function writeSettings(repoPath: string, settings: SettingsShape): void {
  const file = settingsFilePath(repoPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

function getPlugins(settings: SettingsShape): PluginEntry[] {
  return Array.isArray(settings.plugins) ? settings.plugins : [];
}

export function upsertPlugin(repoPath: string, entry: PluginEntry): void {
  const settings = readSettings(repoPath);
  const plugins = getPlugins(settings);
  const idx = plugins.findIndex((p) => p.slug === entry.slug);
  if (idx >= 0) plugins[idx] = entry;
  else plugins.push(entry);
  settings.plugins = plugins;
  writeSettings(repoPath, settings);
}

export function setPluginEnabled(
  repoPath: string,
  slug: string,
  enabled: boolean,
): PluginEntry | null {
  const settings = readSettings(repoPath);
  const plugins = getPlugins(settings);
  const idx = plugins.findIndex((p) => p.slug === slug);
  if (idx < 0) return null;
  const current = plugins[idx]!;
  const next: PluginEntry = { ...current, enabled };
  plugins[idx] = next;
  settings.plugins = plugins;
  writeSettings(repoPath, settings);
  return next;
}

export function removePluginFromSettings(repoPath: string, slug: string): boolean {
  const settings = readSettings(repoPath);
  const plugins = getPlugins(settings);
  const next = plugins.filter((p) => p.slug !== slug);
  if (next.length === plugins.length) return false;
  settings.plugins = next;
  writeSettings(repoPath, settings);
  return true;
}

export function listInstalledPlugins(repoPath: string): InstalledPlugin[] {
  const settings = readSettings(repoPath);
  const plugins = getPlugins(settings);
  const dir = pluginsDir(repoPath);
  const dirEntries = new Set<string>(
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [],
  );

  const result: InstalledPlugin[] = plugins.map((p) => ({
    ...p,
    directoryExists: dirEntries.has(p.slug),
  }));

  for (const name of dirEntries) {
    if (result.some((r) => r.slug === name)) continue;
    result.push({
      slug: name,
      enabled: false,
      source: "git",
      repoUrl: "",
      version: "",
      path: path.join(".claude", "plugins", name),
      directoryExists: true,
    });
  }
  return result;
}

export function uninstallPlugin(repoPath: string, slug: string): {
  removedDir: boolean;
  removedFromSettings: boolean;
} {
  const dir = pluginPath(repoPath, slug);
  let removedDir = false;
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    removedDir = true;
  }
  const removedFromSettings = removePluginFromSettings(repoPath, slug);
  const parent = pluginsDir(repoPath);
  if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
    fs.rmdirSync(parent);
  }
  return { removedDir, removedFromSettings };
}
