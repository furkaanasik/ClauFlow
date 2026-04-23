"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { AgentState, AgentStatus } from "@/types";

interface AgentDescriptor {
  bg: string;
  text: string;
  dot: string;
  label: string;
  pulse: boolean;
}

const AGENT_MAP: Record<AgentStatus, AgentDescriptor> = {
  idle:       { bg: "bg-zinc-800",          text: "text-zinc-400",    dot: "bg-zinc-500",    label: "Bekliyor",          pulse: false },
  branching:  { bg: "bg-blue-950/70",       text: "text-blue-300",    dot: "bg-blue-400",    label: "Branch aciliyor",   pulse: true  },
  running:    { bg: "bg-yellow-950/70",     text: "text-yellow-300",  dot: "bg-yellow-400",  label: "AI yaziyor",        pulse: true  },
  pushing:    { bg: "bg-orange-950/70",     text: "text-orange-300",  dot: "bg-orange-400",  label: "Push ediliyor",     pulse: true  },
  pr_opening: { bg: "bg-purple-950/70",     text: "text-purple-300",  dot: "bg-purple-400",  label: "PR olusturuluyor",  pulse: true  },
  done:       { bg: "bg-emerald-950/70",    text: "text-emerald-300", dot: "bg-emerald-400", label: "Tamamlandi",        pulse: false },
  error:      { bg: "bg-red-950/70",        text: "text-red-300",     dot: "bg-red-400",     label: "Hata olustu",       pulse: false },
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
  const isError = agent.status === "error";

  return (
    <>
      <button
        type="button"
        disabled={!hasLog}
        onClick={(e) => { e.stopPropagation(); if (hasLog) setOpen(true); }}
        aria-label={`Agent: ${desc.label}`}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium transition ${desc.bg} ${desc.text} ${hasLog ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
      >
        {/* Nokta animasyonu veya spinner */}
        {isPulse ? (
          <span className="flex gap-0.5">
            <span className={`h-1 w-1 rounded-full ${desc.dot} animate-dot-1`} />
            <span className={`h-1 w-1 rounded-full ${desc.dot} animate-dot-2`} />
            <span className={`h-1 w-1 rounded-full ${desc.dot} animate-dot-3`} />
          </span>
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${desc.dot}`} />
        )}
        <span>{desc.label}</span>
        {isError && hasLog && (
          <span className="opacity-60">— log</span>
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={taskTitle ? `Ajan Logu — ${taskTitle}` : "Ajan Logu"}
      >
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-300">
          {(agent.log ?? []).join("\n") || "Log bulunmuyor."}
        </pre>
      </Modal>
    </>
  );
}
