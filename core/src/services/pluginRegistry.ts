import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillEntry {
  slug: string;
  name: string;
  description: string;
  repoUrl: string;
  homepage: string;
  version: string;
  author: string;
}

interface RegistryFile {
  version: string;
  skills: SkillEntry[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(here, "..", "data", "skillsRegistry.json");

let cache: SkillEntry[] | null = null;

function load(): SkillEntry[] {
  if (cache) return cache;
  const raw = fs.readFileSync(registryPath, "utf8");
  const parsed = JSON.parse(raw) as RegistryFile;
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error("skillsRegistry.json: invalid shape, expected { skills: [...] }");
  }
  for (const s of parsed.skills) {
    if (
      typeof s.slug !== "string" ||
      typeof s.name !== "string" ||
      typeof s.description !== "string" ||
      typeof s.repoUrl !== "string" ||
      typeof s.homepage !== "string" ||
      typeof s.version !== "string" ||
      typeof s.author !== "string"
    ) {
      throw new Error(`skillsRegistry.json: invalid entry ${JSON.stringify(s)}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug)) {
      throw new Error(`skillsRegistry.json: invalid slug ${s.slug}`);
    }
  }
  cache = parsed.skills;
  return cache;
}

export function getRegistry(): SkillEntry[] {
  return load().slice();
}

export function getSkillBySlug(slug: string): SkillEntry | null {
  return load().find((s) => s.slug === slug) ?? null;
}
