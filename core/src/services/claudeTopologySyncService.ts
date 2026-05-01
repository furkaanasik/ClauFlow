import fs from "node:fs";
import path from "node:path";
import type { AgentGraph } from "../types/index.js";

const BEGIN_MARKER = "<!-- BEGIN AGENT_TOPOLOGY (auto-generated) -->";
const END_MARKER = "<!-- END AGENT_TOPOLOGY -->";

function sanitizeId(slug: string): string {
  const cleaned = slug.replace(/[^A-Za-z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : "n";
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, '\\"');
}

function buildMermaid(
  graph: AgentGraph,
  agents: Array<{ slug: string; name: string }>,
): string {
  const nameBySlug = new Map(agents.map((a) => [a.slug, a.name]));
  const lines: string[] = ["```mermaid", "flowchart TD"];

  if (graph.nodes.length === 0) {
    lines.push("  %% no agents yet");
    lines.push("```");
    return lines.join("\n");
  }

  const safeIdByNode = new Map<string, string>();
  const used = new Set<string>();
  for (const node of graph.nodes) {
    const slug = node.data.slug;
    let base = sanitizeId(slug || node.id);
    let candidate = base;
    let i = 1;
    while (used.has(candidate)) {
      candidate = `${base}${i++}`;
    }
    used.add(candidate);
    safeIdByNode.set(node.id, candidate);
    const label = nameBySlug.get(slug) ?? slug;
    lines.push(`  ${candidate}["${escapeLabel(label)}"]`);
  }

  for (const edge of graph.edges) {
    const from = safeIdByNode.get(edge.source);
    const to = safeIdByNode.get(edge.target);
    if (!from || !to) continue;
    lines.push(`  ${from} --> ${to}`);
  }

  lines.push("```");
  return lines.join("\n");
}

export async function syncTopologyToClaudeMd(
  repoPath: string,
  graph: AgentGraph,
  agents: Array<{ slug: string; name: string }>,
): Promise<void> {
  const claudeMdPath = path.join(repoPath, "CLAUDE.md");
  const mermaid = buildMermaid(graph, agents);
  const block = `${BEGIN_MARKER}\n${mermaid}\n${END_MARKER}`;

  let existing = "";
  if (fs.existsSync(claudeMdPath)) {
    existing = fs.readFileSync(claudeMdPath, "utf8");
  }

  let next: string;
  if (existing.length === 0) {
    next = `${block}\n`;
  } else {
    const beginIdx = existing.indexOf(BEGIN_MARKER);
    const endIdx = existing.indexOf(END_MARKER);
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      const before = existing.slice(0, beginIdx);
      const after = existing.slice(endIdx + END_MARKER.length);
      next = `${before}${block}${after}`;
    } else {
      const sep = existing.endsWith("\n") ? "\n" : "\n\n";
      const trailing = existing.endsWith("\n") ? "\n" : "";
      next = `${existing}${sep}${block}${trailing}`;
      if (!next.endsWith("\n")) next += "\n";
    }
  }

  if (next === existing) return;

  const tmp = `${claudeMdPath}.tmp`;
  fs.writeFileSync(tmp, next, "utf8");
  fs.renameSync(tmp, claudeMdPath);
}
