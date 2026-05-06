"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ClaudeAgent } from "@/lib/api";
import type { NodeRunStatus } from "@/types";
import { skillDragState } from "./dragState";

export interface AgentNodeRunState {
  status: NodeRunStatus;
  nodeRunId: string;
  tokens?: { input: number; output: number };
  model?: string | null;
}

export interface AgentNodeData {
  agent: ClaudeAgent;
  onEdit: (slug: string) => void;
  onRemoveSkill: (slug: string, skillId: string) => void;
  onAddSkill: (slug: string, skillId: string) => void;
  runState?: AgentNodeRunState;
  validationError?: { reason: string };
  onAbortNode?: (nodeId: string) => void;
  onRetryNode?: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

const STATUS_RING: Record<NodeRunStatus, string> = {
  running: "ring-2 ring-blue-500 animate-pulse",
  done: "ring-2 ring-emerald-500",
  error: "ring-2 ring-rose-500",
  aborted: "ring-2 ring-amber-500",
};

type NodeKind = "main" | "planner" | "coder" | "reviewer" | "tester" | "ci" | "fix" | "custom";

interface NodeAccent {
  border: string;
  header: string;
  badge: string;
  label: string;
}

const NODE_ACCENT: Record<NodeKind, NodeAccent> = {
  main: {
    border: "border-2 border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.15)]",
    header: "bg-amber-400/15",
    badge: "bg-amber-400/20 text-amber-300 border-amber-400/60",
    label: "★ entry",
  },
  planner: {
    border: "border-l-4 border-l-indigo-500",
    header: "bg-indigo-500/10",
    badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
    label: "planner",
  },
  coder: {
    border: "border-l-4 border-l-emerald-500",
    header: "bg-emerald-500/10",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    label: "coder",
  },
  reviewer: {
    border: "border-l-4 border-l-amber-500",
    header: "bg-amber-500/10",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    label: "reviewer",
  },
  tester: {
    border: "border-l-4 border-l-cyan-500",
    header: "bg-cyan-500/10",
    badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
    label: "tester",
  },
  ci: {
    border: "border-l-4 border-l-violet-500",
    header: "bg-violet-500/10",
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/40",
    label: "ci",
  },
  fix: {
    border: "border-l-4 border-l-rose-500",
    header: "bg-rose-500/10",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    label: "fix",
  },
  custom: {
    border: "border-l-4 border-l-slate-500",
    header: "bg-slate-500/10",
    badge: "bg-slate-500/15 text-slate-300 border-slate-500/40",
    label: "custom",
  },
};

const KNOWN_KINDS: NodeKind[] = ["planner", "coder", "reviewer", "tester", "ci", "fix"];

function deriveNodeKind(slug: string): NodeKind {
  if (slug === "main") return "main";
  const lower = slug.toLowerCase();
  for (const k of KNOWN_KINDS) {
    if (lower === k || lower.startsWith(`${k}-`) || lower.endsWith(`-${k}`)) {
      return k;
    }
  }
  return "custom";
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
  const {
    agent,
    onEdit,
    onRemoveSkill,
    onAddSkill,
    runState,
    validationError,
    onAbortNode,
    onRetryNode,
    onSelectNode,
  } = d;
  const skills = parseSkillsFromBody(agent.body ?? "");
  const [hoverSkill, setHoverSkill] = useState<string | null>(null);
  const showGhost = hoverSkill !== null && !skills.includes(hoverSkill);

  const ringClass = runState ? STATUS_RING[runState.status] : "";
  const invalidClass = validationError
    ? "ring-2 ring-rose-500 ring-offset-1 ring-offset-[var(--cf-surface)]"
    : "";
  const kind = deriveNodeKind(agent.slug);
  const accent = NODE_ACCENT[kind];

  return (
    <div
      className={`min-w-[180px] max-w-[240px] border border-[var(--cf-border)] bg-[var(--cf-bg)] shadow-sm ${accent.border} ${ringClass} ${invalidClass}`.trim()}
      onClick={() => onSelectNode?.(agent.slug)}
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
      <Handle type="target" position={Position.Top} className="!border-[var(--cf-border)] !bg-[var(--cf-surface)]" />

      {/* Header */}
      <div
        className={`flex items-center justify-between gap-2 border-b border-[var(--cf-border)] px-3 py-2 ${accent.header}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${accent.badge}`}
          >
            {accent.label}
          </span>
          <span className="truncate font-mono text-[12px] font-semibold text-[var(--cf-text)]">
            {agent.name || agent.slug}
          </span>
        </div>
        {agent.model && (
          <span className="shrink-0 rounded bg-[var(--cf-surface)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--cf-muted)]">
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
              className="group inline-flex items-center gap-1 rounded border border-[var(--cf-border)] bg-[var(--cf-surface)] py-0.5 pl-1.5 pr-1 font-mono text-[9px] text-[var(--cf-muted)]"
            >
              {sk}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSkill(agent.slug, sk);
                }}
                className="flex h-3 w-3 items-center justify-center text-[var(--cf-muted)] opacity-0 transition hover:text-[#ef4444] group-hover:opacity-100"
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
              className="rounded border border-dashed border-[var(--cf-muted)] bg-[var(--cf-surface)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--cf-muted)] opacity-60"
            >
              {hoverSkill}
            </span>
          )}
        </div>
      )}

      {(runState || validationError) && (
        <div className="flex items-center justify-between gap-2 border-t border-[var(--cf-border)] px-3 py-1.5 text-[10px]">
          {runState && (
            <span className="font-mono text-[var(--cf-muted)]">
              {runState.status}
            </span>
          )}
          {validationError && !runState && (
            <span className="font-mono text-rose-500">
              {validationError.reason}
            </span>
          )}
          <span className="flex gap-1">
            {runState?.status === "running" && onAbortNode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAbortNode(agent.slug);
                }}
                className="rounded border border-[var(--cf-border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--cf-muted)] hover:text-rose-500"
              >
                abort
              </button>
            )}
            {runState &&
              (runState.status === "error" || runState.status === "aborted") &&
              onRetryNode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryNode(agent.slug);
                  }}
                  className="rounded border border-[var(--cf-border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--cf-muted)] hover:text-emerald-500"
                >
                  retry
                </button>
              )}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!border-[var(--cf-border)] !bg-[var(--cf-surface)]" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
