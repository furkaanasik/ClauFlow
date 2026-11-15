"use client";

import { StatusPill } from "@/components/ui/Pills";
import { useTranslation } from "@/hooks/useTranslation";

interface CiBadgeProps {
  iteration: number;       // current fix iteration (0 = first poll, no fix yet)
  maxIterations: number;   // CI_MAX_FIX_ITERATIONS from env (default 3)
  lastConclusion: "pass" | "fail" | "pending";
}

export function CiBadge({ iteration, maxIterations, lastConclusion }: CiBadgeProps) {
  const t = useTranslation();
  const fill = (s: string) => s.replace("{n}", String(iteration)).replace("{max}", String(maxIterations));

  if (lastConclusion === "pass") {
    return <StatusPill status="done">{t.taskCard.ci.passing}</StatusPill>;
  }
  if (lastConclusion === "fail") {
    return <StatusPill status="error">{fill(t.taskCard.ci.fail)}</StatusPill>;
  }
  return (
    <StatusPill status="ci" live>
      {iteration > 0 ? fill(t.taskCard.ci.fix) : t.taskCard.ci.checking}
    </StatusPill>
  );
}
