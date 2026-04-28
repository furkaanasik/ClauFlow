"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { AgentState, AgentStatus } from "@/types";

interface AgentDescriptor {
  ink:   string;
  label: string;
  pulse: boolean;
}

const AGENT_MAP: Record<AgentStatus, AgentDescriptor> = {
  idle:       { ink: "var(--text-muted)",       label: "idle",         pulse: false },
  branching:  { ink: "var(--status-info)",      label: "branching",    pulse: true  },
  running:    { ink: "var(--status-doing)",     label: "agent writes", pulse: true  },
  pushing:    { ink: "var(--prio-high)",        label: "pushing",      pulse: true  },
  pr_opening: { ink: "var(--status-review)",    label: "opening pr",   pulse: true  },
  done:       { ink: "var(--accent-primary)",   label: "done",         pulse: false },
  error:      { ink: "var(--status-error)",     label: "error",        pulse: false },
};

interface AgentBadgeProps {
  agent: AgentState;
  taskTitle?: string;
}

export function AgentBadge({ agent, taskTitle }: AgentBadgeProps) {
  const [open, setOpen] = useState(false);
  const desc   = AGENT_MAP[agent.status] ?? AGENT_MAP.idle;
  const hasLog = (agent.log?.length ?? 0) > 0;
  const isPulse = desc.pulse;

  return (
    <>
      <button
        type="button"
        disabled={!hasLog}
        onClick={(e) => { e.stopPropagation(); if (hasLog) setOpen(true); }}
        aria-label={`Agent: ${desc.label}`}
        className={`inline-flex items-center gap-1.5 border border-[var(--border)] px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition ${hasLog ? "cursor-pointer hover:border-[var(--border-strong)]" : "cursor-default"}`}
        style={{ color: desc.ink }}
      >
        {isPulse ? (
          <span className="flex items-center gap-0.5">
            <span className="h-1 w-1 animate-dot-1" style={{ background: desc.ink }} />
            <span className="h-1 w-1 animate-dot-2" style={{ background: desc.ink }} />
            <span className="h-1 w-1 animate-dot-3" style={{ background: desc.ink }} />
          </span>
        ) : (
          <span className="h-1 w-1" style={{ background: desc.ink }} />
        )}
        <span>{desc.label}</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={taskTitle ? `Agent log — ${taskTitle}` : "Agent log"}
      >
        <pre className="analysis-block max-h-[60vh] overflow-auto whitespace-pre-wrap break-words p-4">
          {(agent.log ?? []).join("\n") || "Log empty."}
        </pre>
      </Modal>
    </>
  );
}
