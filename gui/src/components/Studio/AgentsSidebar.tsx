"use client";

import { type ClaudeAgent } from "@/lib/api";

interface AgentsSidebarProps {
  agents: ClaudeAgent[];
  canvasNodeIds: Set<string>;
  onNewAgent: () => void;
  onGenerate: () => void;
}

export function AgentsSidebar({ agents, canvasNodeIds, onNewAgent, onGenerate }: AgentsSidebarProps) {
  const draggable = agents.filter((a) => a.slug !== "main");

  return (
    <div className="flex w-48 shrink-0 flex-col border-l border-[var(--cf-border)] bg-[var(--cf-surface)]">
      <div className="flex items-center border-b border-[var(--cf-border)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--cf-muted)]">
          Agents
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {draggable.length === 0 ? (
          <div className="px-1 py-3 text-center text-[10px] text-[var(--cf-muted)]">
            No agents yet
          </div>
        ) : (
          draggable.map((agent) => {
            const onCanvas = canvasNodeIds.has(agent.slug);
            return (
              <div
                key={agent.slug}
                draggable={!onCanvas}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-agent-slug", agent.slug);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                title={onCanvas ? `${agent.slug} is on canvas` : `Drag to add ${agent.slug}`}
                className={[
                  "flex items-center gap-1.5 rounded border px-2 py-1.5 font-mono text-[10px] select-none",
                  onCanvas
                    ? "border-[var(--cf-border)] text-[var(--cf-muted)] opacity-50 cursor-default"
                    : "cursor-grab border-[var(--cf-border)] bg-[var(--cf-bg)] text-[var(--cf-muted)] transition hover:border-[var(--cf-muted)] hover:text-[var(--cf-text)] active:cursor-grabbing",
                ].join(" ")}
              >
                <span className="truncate">{agent.slug}</span>
                {onCanvas && (
                  <span className="ml-auto shrink-0 text-[8px] text-[var(--cf-muted)]">●</span>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-[var(--cf-border)] p-2">
        <button
          type="button"
          onClick={onNewAgent}
          style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 4, padding: "6px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer", width: "100%" }}
        >
          + New agent
        </button>
        <button
          type="button"
          onClick={onGenerate}
          className="w-full border border-[var(--cf-border)] bg-[var(--cf-bg)] px-2 py-1.5 text-[10px] text-[var(--cf-muted)] transition hover:border-[var(--cf-muted)] hover:text-[var(--cf-text)]"
        >
          Generate from prompt
        </button>
      </div>
    </div>
  );
}
