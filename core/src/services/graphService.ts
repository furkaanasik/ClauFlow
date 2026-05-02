import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AgentGraph } from "../types/index.js";

export const graphNodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.literal("agent"),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({ slug: z.string().min(1).max(120) }),
});

export const graphEdgeSchema = z.object({
  id: z.string().min(1).max(240),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
});

export const graphSchema = z.object({
  nodes: z.array(graphNodeSchema).max(500),
  edges: z.array(graphEdgeSchema).max(2000),
});

export function agentsDir(repoPath: string): string {
  return path.join(repoPath, ".claude", "agents");
}

export function agentFilePath(repoPath: string, slug: string): string {
  return path.join(agentsDir(repoPath), `${slug}.md`);
}

export function graphFilePath(repoPath: string): string {
  return path.join(agentsDir(repoPath), "_graph.json");
}

export function loadGraph(repoPath: string): AgentGraph | null {
  const file = graphFilePath(repoPath);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = graphSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface AgentFrontmatter {
  name?: string;
  model?: string;
  description?: string;
  allowedTools?: string;
  [key: string]: string | undefined;
}

export interface ParsedAgent {
  frontmatter: AgentFrontmatter;
  body: string;
}

export function parseAgentFile(raw: string): ParsedAgent {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const fmRaw = match[1] ?? "";
  const body = match[2] ?? "";
  const frontmatter: AgentFrontmatter = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[m[1]!] = value;
  }
  return { frontmatter, body };
}

export function serializeAgentFile(
  fm: AgentFrontmatter,
  body: string,
): string {
  const keys = ["name", "model", "description", "allowedTools"] as const;
  const lines: string[] = ["---"];
  for (const k of keys) {
    const v = fm[k];
    if (v === undefined || v === "") continue;
    const safe = /[:#\n"']/.test(v) ? JSON.stringify(v) : v;
    lines.push(`${k}: ${safe}`);
  }
  lines.push("---", "");
  return (
    lines.join("\n") +
    (body.startsWith("\n") ? body : `\n${body}`).replace(/^\n+/, "\n")
  );
}

export interface AgentDefinition {
  slug: string;
  frontmatter: AgentFrontmatter;
  body: string;
  allowedTools: string[] | null;
}

export function loadAgentDefinition(
  repoPath: string,
  slug: string,
): AgentDefinition | null {
  const file = agentFilePath(repoPath, slug);
  if (!fs.existsSync(file)) return null;
  const { frontmatter, body } = parseAgentFile(fs.readFileSync(file, "utf8"));
  const tools =
    frontmatter.allowedTools && frontmatter.allowedTools.trim()
      ? frontmatter.allowedTools
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : null;
  return { slug, frontmatter, body, allowedTools: tools };
}
