"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ClaudeAgent } from "@/lib/api";
import { skillDragState } from "./dragState";

export interface AgentNodeData {
  agent: ClaudeAgent;
  onEdit: (slug: string) => void;
  onRemoveSkill: (slug: string, skillId: string) => void;
  onAddSkill: (slug: string, skillId: string) => void;
}

function parseSkillsFromBody(body: string): string[] {
  const sectionMatch = body.match(/##\s+Available Skills\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!sectionMatch) return [];
  const table = sectionMatch[1];
  const rows = table.split("\n").filter((l) => l.trim().startsWith("|"));
  const skills: string[] = [];
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 1 && cells[0] !== "Skill" && !cells[0].startsWith("-")) {
      skills.push(cells[0]);
    }
  }
  return skills;
}

function AgentNodeComponent({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const { agent, onEdit, onRemoveSkill, onAddSkill } = d;
  const skills = parseSkillsFromBody(agent.body ?? "");
  const [hoverSkill, setHoverSkill] = useState<string | null>(null);
  const showGhost = hoverSkill !== null && !skills.includes(hoverSkill);

  return (
    <div
      className="min-w-[180px] max-w-[240px] border border-[var(--border)] bg-[var(--bg-base)] shadow-sm"
      onDoubleClick={() => onEdit(agent.slug)}
      onDragOver={(e) => {
        const dragged = skillDragState.skillId;
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        if (hoverSkill !== dragged) setHoverSkill(dragged);
      }}
      onDragLeave={() => setHoverSkill(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const sk = e.dataTransfer.getData("application/x-skill-id") || skillDragState.skillId;
        setHoverSkill(null);
        skillDragState.skillId = null;
        if (sk && !skills.includes(sk)) onAddSkill(agent.slug, sk);
      }}
    >
      <Handle type="target" position={Position.Top} className="!border-[var(--border)] !bg-[var(--bg-surface)]" />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="truncate font-mono text-[12px] font-semibold text-[var(--text-primary)]">
          {agent.name || agent.slug}
        </span>
        {agent.model && (
          <span className="shrink-0 rounded bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-faint)]">
            {agent.model.replace("claude-", "").replace(/-\d{8}$/, "")}
          </span>
        )}
      </div>

      {/* Skills */}
      {(skills.length > 0 || showGhost) && (
        <div className="flex flex-wrap gap-1 px-3 py-2">
          {skills.map((sk) => (
            <span
              key={sk}
              className="group inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] py-0.5 pl-1.5 pr-1 font-mono text-[9px] text-[var(--text-muted)]"
            >
              {sk}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSkill(agent.slug, sk);
                }}
                className="flex h-3 w-3 items-center justify-center text-[var(--text-faint)] opacity-0 transition hover:text-[var(--status-error)] group-hover:opacity-100"
                aria-label={`Remove ${sk}`}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l6 6M7 1l-6 6" />
                </svg>
              </button>
            </span>
          ))}
          {showGhost && (
            <span
              key={`ghost-${hoverSkill}`}
              className="rounded border border-dashed border-[var(--text-secondary)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-faint)] opacity-60"
            >
              {hoverSkill}
            </span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!border-[var(--border)] !bg-[var(--bg-surface)]" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
