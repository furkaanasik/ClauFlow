"use client";

import { memo, useState, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ClaudeAgent } from "@/lib/api";
import type { NodeRunStatus } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import { IconClose, IconRetry, IconStop, IconTag } from "@/components/ui/icons";
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

/** Run status → token colour (fill) + text-safe colour. */
const RUN_TONE: Record<NodeRunStatus, { fill: string; text: string }> = {
  running: { fill: "var(--orange)", text: "var(--orange-text)" },
  done: { fill: "var(--green)", text: "var(--green-text)" },
  error: { fill: "var(--red)", text: "var(--red-text)" },
  aborted: { fill: "var(--mustard)", text: "var(--mustard-text)" },
};

type NodeKind = "main" | "planner" | "coder" | "reviewer" | "tester" | "ci" | "fix" | "custom";

/** Cap colour per role. Text label carries the meaning, colour supports it. */
const KIND_CAP: Record<NodeKind, { fill: string; on: string }> = {
  main: { fill: "var(--mustard)", on: "var(--on-mustard)" },
  planner: { fill: "var(--cobalt)", on: "var(--on-cobalt)" },
  coder: { fill: "var(--green)", on: "var(--on-green)" },
  reviewer: { fill: "var(--orange)", on: "var(--on-orange)" },
  tester: { fill: "var(--ink-2)", on: "var(--on-ink)" },
  ci: { fill: "var(--cobalt)", on: "var(--on-cobalt)" },
  fix: { fill: "var(--red)", on: "var(--on-red)" },
  custom: { fill: "var(--ink-3)", on: "var(--on-ink)" },
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

function shortModel(model: string) {
  return model.replace("claude-", "").replace(/-\d{8}$/, "");
}

/**
 * Studio node: a tactile Atölye panel. Coloured role cap, ink rule, hard
 * shadow; run state recolours the shadow and adds a status strip.
 */
function AgentNodeComponent({ data, selected }: NodeProps) {
  const t = useTranslation();
  const st = t.studio;
  const d = data as unknown as AgentNodeData;
  const {
    agent,
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

  const kind = deriveNodeKind(agent.slug);
  const cap = KIND_CAP[kind];
  const tone = runState ? RUN_TONE[runState.status] : null;

  const style = {
    "--cap": cap.fill,
    "--cap-on": cap.on,
    ...(tone ? { "--run": tone.fill } : null),
  } as CSSProperties;

  return (
    <div
      className="agent-node"
      style={style}
      data-kind={kind}
      data-run={runState?.status}
      data-invalid={validationError ? "true" : undefined}
      data-drop={showGhost ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
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
      <Handle type="target" position={Position.Top} className="agent-node__handle" />

      {/* Role cap */}
      <div className="agent-node__cap">
        <span className="agent-node__kind">
          {kind === "main" ? `★ ${st.kindEntry}` : st.kinds[kind]}
        </span>
        {agent.model && <span className="agent-node__model">{shortModel(agent.model)}</span>}
      </div>

      {/* Name */}
      <div className="flex flex-col gap-0.5 px-3 pb-2 pt-2.5">
        <span className="truncate text-[14px] font-bold leading-tight text-ink">
          {agent.name || agent.slug}
        </span>
        {agent.name && agent.name !== agent.slug && (
          <span className="truncate font-mono text-[10.5px] text-ink-3">{agent.slug}</span>
        )}
      </div>

      {/* Skills */}
      {(skills.length > 0 || showGhost) && (
        <div className="flex flex-wrap gap-1 px-3 pb-2.5">
          {skills.map((sk) => (
            <span key={sk} className="agent-node__skill group">
              <IconTag size={9} className="text-ink-3" />
              {sk}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveSkill(agent.slug, sk);
                }}
                className="nodrag grid h-3.5 w-3.5 place-items-center rounded-full text-ink-3 opacity-0 transition hover:bg-red hover:text-[var(--on-red)] group-hover:opacity-100"
                aria-label={st.removeSkill.replace("{skill}", sk)}
              >
                <IconClose size={8} />
              </button>
            </span>
          ))}
          {showGhost && (
            <span key={`ghost-${hoverSkill}`} className="agent-node__skill agent-node__skill--ghost">
              + {hoverSkill}
            </span>
          )}
        </div>
      )}
      {skills.length === 0 && !showGhost && (
        <div className="px-3 pb-2.5">
          <span className="block rounded-[7px] border-[1.5px] border-dashed border-hair px-2 py-1 text-center text-[10.5px] text-ink-3">
            {st.dropSkillHint}
          </span>
        </div>
      )}

      {(runState || validationError) && (
        <div className="agent-node__foot">
          {runState && (
            <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] font-semibold" style={{ color: tone?.text }}>
              <span
                aria-hidden
                className={runState.status === "running" ? "ui-dot ui-dot--live !h-2 !w-2" : "ui-dot !h-2 !w-2"}
                style={{ "--dot": tone?.fill } as CSSProperties}
              />
              {st.runStatus[runState.status]}
              {runState.tokens && runState.tokens.input + runState.tokens.output > 0 && (
                <span className="font-normal text-ink-3">
                  · {Math.round((runState.tokens.input + runState.tokens.output) / 100) / 10}k
                </span>
              )}
            </span>
          )}
          {validationError && !runState && (
            <span className="min-w-0 truncate font-mono text-[10.5px] font-semibold text-[var(--red-text)]">
              {validationError.reason}
            </span>
          )}
          <span className="ml-auto flex gap-1">
            {runState?.status === "running" && onAbortNode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAbortNode(agent.slug);
                }}
                className="agent-node__btn nodrag"
              >
                <IconStop size={9} />
                {st.abort}
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
                  className="agent-node__btn nodrag"
                >
                  <IconRetry size={9} />
                  {st.retry}
                </button>
              )}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="agent-node__handle" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
