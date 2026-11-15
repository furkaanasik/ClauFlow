"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/Modal";
import { StatusPill, type StatusKind } from "@/components/ui/Pills";
import { useTranslation } from "@/hooks/useTranslation";
import { IconTerminal } from "@/components/ui/icons";
import { LogViewer } from "@/components/Card/LogViewer";
import type { AgentState, AgentStatus } from "@/types";

/** The four live executor steps, in order (spec §5). */
export const AGENT_STEPS: AgentStatus[] = ["branching", "running", "pushing", "pr_opening"];

const STEP_KIND: Record<AgentStatus, StatusKind> = {
  idle: "todo",
  branching: "doing",
  running: "doing",
  pushing: "doing",
  pr_opening: "doing",
  done: "done",
  error: "error",
};

interface AgentBadgeProps {
  agent: AgentState;
  taskTitle?: string;
}

/**
 * Live agent step pill: "◉ Agent writing" plus a 4-notch step tracker while
 * the executor runs. Clicking opens the agent log (portalled so a transformed
 * card never traps the fixed overlay).
 */
export function AgentBadge({ agent, taskTitle }: AgentBadgeProps) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const hasLog = (agent.log?.length ?? 0) > 0;
  const stepIdx = AGENT_STEPS.indexOf(agent.status);
  const live = stepIdx >= 0;
  const label = t.taskCard.agentSteps[agent.status] ?? agent.status;

  return (
    <>
      <button
        type="button"
        disabled={!hasLog}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (hasLog) setOpen(true);
        }}
        title={hasLog ? t.taskCard.openLog : label}
        className="ui-focus inline-flex items-center gap-1.5 rounded-pill disabled:cursor-default"
      >
        <StatusPill status={STEP_KIND[agent.status]} variant={live ? "solid" : "soft"} live={live}>
          {label}
          {live && (
            <span className="ml-0.5 inline-flex items-center gap-[3px]" aria-hidden>
              {AGENT_STEPS.map((s, i) => (
                <span
                  key={s}
                  className="inline-block h-[7px] w-[7px] rounded-[2px] border border-current"
                  style={{ background: i <= stepIdx ? "currentColor" : "transparent" }}
                />
              ))}
            </span>
          )}
        </StatusPill>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title={t.taskCard.agentLog}
            description={taskTitle}
            icon={<IconTerminal size={18} />}
            size="xl"
            footerStart={t.taskDetail.lines((agent.log ?? []).length)}
            footer={
              <StatusPill status={STEP_KIND[agent.status]} variant={live ? "solid" : "soft"} live={live}>
                {label}
              </StatusPill>
            }
          >
            <LogViewer
              lines={agent.log ?? []}
              follow
              live={live}
              followLabel={t.taskDetail.follow}
              emptyLabel={t.taskCard.logEmpty}
              ariaLabel={t.taskCard.agentLog}
              className="h-[58vh]"
            />
          </Modal>,
          document.body,
        )}
    </>
  );
}
