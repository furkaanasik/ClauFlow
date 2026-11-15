"use client";

import type { CSSProperties } from "react";
import { RingGauge } from "@/components/ui/Meters";
import { useTranslation } from "@/hooks/useTranslation";
import { formatUsd } from "@/lib/format";

interface BoardStatsProps {
  total: number;
  done: number;
  running: number;
  cost: number;
}

/** Compact summary plate: done-ratio ring plus total / done / running / cost. */
export function BoardStats({ total, done, running, cost }: BoardStatsProps) {
  const t = useTranslation();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section
      aria-label={t.board.stats.label}
      className="ui-panel ui-panel--raised flex items-center gap-4 py-2 pl-2.5 pr-5"
    >
      <RingGauge
        value={done}
        max={Math.max(total, 1)}
        size={60}
        thickness={8}
        color="var(--green)"
        ariaLabel={`${t.board.stats.progress} ${pct}%`}
      >
        <span className="text-[13px]">{pct}%</span>
      </RingGauge>
      <dl className="flex items-center gap-5">
        <Stat label={t.board.stats.total} value={String(total)} />
        <Stat label={t.board.stats.done} value={String(done)} color="var(--green-text)" />
        <Stat
          label={t.board.stats.running}
          value={String(running)}
          color={running > 0 ? "var(--orange-text)" : undefined}
          live={running > 0}
        />
        <Stat label={t.board.stats.cost} value={formatUsd(cost)} />
      </dl>
    </section>
  );
}

function Stat({ label, value, color, live }: { label: string; value: string; color?: string; live?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="t-label !text-[10px] !tracking-[0.12em] !text-ink-3">{label}</dt>
      <dd
        className="flex items-center gap-1.5 font-mono text-[20px] font-bold leading-none tabular-nums text-ink"
        style={color ? { color } : undefined}
      >
        {live && <span aria-hidden className="ui-dot ui-dot--live !h-2 !w-2" style={{ "--dot": "var(--orange)" } as CSSProperties} />}
        {value}
      </dd>
    </div>
  );
}
