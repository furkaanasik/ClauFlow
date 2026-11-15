"use client";

import { type ClaudeAgent } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { IconBolt, IconCheck, IconPlus, IconRobot } from "@/components/ui/icons";

interface AgentsSidebarProps {
  agents: ClaudeAgent[];
  canvasNodeIds: Set<string>;
  onNewAgent: () => void;
  onGenerate: () => void;
}

export function AgentsSidebar({ agents, canvasNodeIds, onNewAgent, onGenerate }: AgentsSidebarProps) {
  const st = useTranslation().studio;
  const draggable = agents.filter((a) => a.slug !== "main");

  return (
    <div className="studio-side border-l-2">
      <div className="studio-side__head">
        <IconRobot size={14} />
        <span className="flex-1">{st.agentsTitle}</span>
        <span className="studio-side__count">{draggable.length}</span>
      </div>
      <p className="px-3 pt-2.5 text-[11.5px] leading-snug text-ink-3">{st.agentsHint}</p>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2.5">
        {draggable.length === 0 ? (
          <div className="ui-hatch flex flex-col items-center gap-2 rounded-[10px] border-2 border-dashed border-hair px-3 py-6 text-center">
            <Avatar name="agent" kind="agent" size="sm" />
            <span className="text-[12px] text-ink-3">{st.noAgents}</span>
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
                title={onCanvas ? st.onCanvasTitle.replace("{slug}", agent.slug) : st.dragAgentTitle.replace("{slug}", agent.slug)}
                className="studio-item"
                data-placed={onCanvas ? "true" : undefined}
              >
                <Avatar name={agent.slug} kind="agent" size="xs" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[12.5px] font-semibold text-ink">{agent.name || agent.slug}</span>
                  {agent.model && <span className="truncate font-mono text-[10px] text-ink-3">{agent.model}</span>}
                </span>
                {onCanvas ? (
                  <span className="grid h-4 w-4 flex-none place-items-center rounded-full border-[1.5px] border-line bg-green text-[var(--on-green)]" aria-label={st.onCanvas}>
                    <IconCheck size={9} />
                  </span>
                ) : (
                  <span aria-hidden className="studio-item__grip" />
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-2 border-t-2 border-line p-2.5">
        <Button size="sm" variant="primary" block icon={<IconPlus size={13} />} onClick={onNewAgent}>
          {st.newAgent}
        </Button>
        <Button size="sm" variant="secondary" block icon={<IconBolt size={13} />} onClick={onGenerate}>
          {st.generateFromPrompt}
        </Button>
      </div>
    </div>
  );
}
