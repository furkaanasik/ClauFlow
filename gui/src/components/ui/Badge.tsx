import clsx from "clsx";
import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "blue"
  | "yellow"
  | "orange"
  | "purple"
  | "green"
  | "red";

const TONE_INK: Record<BadgeTone, string> = {
  neutral: "var(--text-secondary)",
  blue:    "var(--status-info)",
  yellow:  "var(--status-warning)",
  orange:  "var(--prio-high)",
  purple:  "var(--status-review)",
  green:   "var(--accent-primary)",
  red:     "var(--status-error)",
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  pulse?: boolean;
}

export function Badge({
  tone = "neutral",
  children,
  className,
  pulse = false,
}: BadgeProps) {
  const ink = TONE_INK[tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest",
        pulse && "animate-pulse",
        className,
      )}
      style={{ borderColor: ink, color: ink }}
    >
      <span className="h-1 w-1" style={{ background: ink }} />
      {children}
    </span>
  );
}
