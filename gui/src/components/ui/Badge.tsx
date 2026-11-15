import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "blue"
  | "yellow"
  | "orange"
  | "purple"
  | "green"
  | "red";

/** Legacy tone names → Atölye tokens. `purple` was the review colour. */
const TONE: Record<BadgeTone, { dot: string; text: string }> = {
  neutral: { dot: "var(--ink-3)", text: "var(--ink-2)" },
  blue: { dot: "var(--cobalt)", text: "var(--cobalt-text)" },
  yellow: { dot: "var(--mustard)", text: "var(--mustard-text)" },
  orange: { dot: "var(--orange)", text: "var(--orange-text)" },
  purple: { dot: "var(--mustard)", text: "var(--mustard-text)" },
  green: { dot: "var(--green)", text: "var(--green-text)" },
  red: { dot: "var(--red)", text: "var(--red-text)" },
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
  const c = TONE[tone];
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-panel px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
        className,
      )}
      style={{ color: c.text }}
    >
      <span
        aria-hidden
        className={clsx("ui-dot !h-1.5 !w-1.5 !border-0", pulse && "ui-dot--live")}
        style={{ "--dot": c.dot } as CSSProperties}
      />
      {children}
    </span>
  );
}
