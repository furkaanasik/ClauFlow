"use client";

import { IconChain } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";
import { blockerProblem, isWaitingDeps, unmetDeps } from "@/lib/boardView";
import { errorText } from "@/lib/errorText";
import type { Task } from "@/types";

const keyOf = (t: Task) => t.displayId ?? `#${t.id.slice(0, 7)}`;

/**
 * zincir chain badge (§5.6, §3/14): "Waiting for CLF-2" / "Waiting for 2 tasks",
 * or "CLF-2 has a problem" when a dependency failed (§3/11). Shown on a To do
 * or waiting task with unmet dependencies. A non-interactive span: the full
 * list (key · column, or key · reason) sits in `title`; the drawer has the rest.
 */
export function ChainBadge({ task, compact = false }: { task: Task; compact?: boolean }) {
  const t = useTranslation();
  const tasks = useBoardStore((s) => s.tasks);
  if (task.status !== "todo" && !isWaitingDeps(task)) return null;
  const unmet = unmetDeps(task, tasks);
  if (unmet.length === 0) return null;

  const problems = unmet.filter(blockerProblem);
  const problem = problems[0];
  const text = problem
    ? t.taskCard.blockerProblem(keyOf(problem))
    : unmet.length === 1
      ? t.taskCard.waitingOne(keyOf(unmet[0]!))
      : t.taskCard.waitingMany(unmet.length);
  const title = [
    t.taskCard.waitingTitle,
    ...unmet.map((d) => {
      const state = blockerProblem(d) && d.agent.error ? errorText(t, d.agent.error) : t.board.columns[d.status];
      return `${keyOf(d)} · ${state}`;
    }),
  ].join("\n");

  return (
    <span
      className="task-card__meta"
      data-chain={problem ? "problem" : "waiting"}
      title={title}
      style={problem ? { background: "var(--red)", color: "var(--on-red)" } : undefined}
    >
      <IconChain size={12} />
      {compact ? (
        <>
          <span aria-hidden>{problem ? `${keyOf(problem)} !` : unmet.length}</span>
          <span className="sr-only">{text}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
