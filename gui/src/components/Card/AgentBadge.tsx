"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/Modal";
import { StatusPill, type StatusKind } from "@/components/ui/Pills";
import { useTranslation } from "@/hooks/useTranslation";
import { IconTerminal } from "@/components/ui/icons";
import { LogViewer } from "@/components/Card/LogViewer";
import { agentStepLabel, roleIcon, teamStepKind } from "@/components/Team/roleMeta";
import { useBoardStore } from "@/store/boardStore";
import { errorText } from "@/lib/errorText";
import type { AgentState, AgentStatus } from "@/types";

/** The four live executor steps, in order (spec §5). */
const AGENT_STEPS: AgentStatus[] = ["branching", "running", "pushing", "pr_opening"];

const STEP_KIND: Record<AgentStatus, StatusKind> = {
  idle: "todo",
  branching: "doing",
  running: "doing",
  pushing: "doing",
  pr_opening: "doing",
  awaiting_approval: "review",
  done: "done",
  error: "error",
};

interface AgentBadgeProps {
  agent: AgentState;
  taskTitle?: string;
  /** Lets the badge read the live team run (QA round) from the store. */
  taskId?: string;
}

/**
 * Live agent step pill: "◉ Agent writing" plus a 4-notch step tracker while
 * the executor runs. Clicking opens the agent log (portalled so a transformed
 * card never traps the fixed overlay).
 */
export function AgentBadge({ agent, taskTitle, taskId }: AgentBadgeProps) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const qaRound = useBoardStore((s) => {
    const runs = taskId ? s.teamRuns[taskId] : undefined;
    return runs?.[runs.length - 1]?.qaRound ?? 0;
  });
  const hasLog = (agent.log?.length ?? 0) > 0;
  const stepIdx = AGENT_STEPS.indexOf(agent.status);
  const live = stepIdx >= 0;
  // Team runs: "QA kontrol ediyor · tur 2" with the role glyph in place of the dot.
  const roleKind = agent.status === "running" ? teamStepKind(agent.currentStep) : null;
  const awaiting = agent.status === "awaiting_approval";
  const label = agentStepLabel(agent, t, qaRound);
  const variant = live || awaiting ? "solid" : "soft";
  const icon = roleKind ? roleIcon(roleKind, 12) : undefined;
  // zincir F0.5: an error pill says why, not just "open log".
  const reason = agent.status === "error" && agent.error ? errorText(t, agent.error) : null;
  const hint = reason ? (hasLog ? `${reason} · ${t.taskCard.openLog}` : reason) : hasLog ? t.taskCard.openLog : label;

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
        title={hint}
        aria-label={reason ? hint : undefined}
        className="ui-focus inline-flex items-center gap-1.5 rounded-pill disabled:cursor-default"
      >
        <StatusPill status={STEP_KIND[agent.status]} variant={variant} live={live} icon={icon}>
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
              <StatusPill status={STEP_KIND[agent.status]} variant={variant} live={live} icon={icon}>
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
