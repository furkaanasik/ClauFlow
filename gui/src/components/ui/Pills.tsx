import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

/* ─── SectionPill ─────────────────────────────────────────────────────────── */

export interface SectionPillProps {
  children: ReactNode;
  icon?: ReactNode;
  /** Optional trailing number, e.g. "Upgrades 3". */
  count?: number;
  tone?: "cobalt" | "ink" | "mustard";
  size?: "sm" | "md";
  className?: string;
}

const SECTION_TONE: Record<NonNullable<SectionPillProps["tone"]>, CSSProperties> = {
  cobalt: { background: "var(--cobalt)", color: "var(--on-cobalt)" },
  ink: { background: "var(--ink)", color: "var(--on-ink)" },
  mustard: { background: "var(--mustard)", color: "var(--on-mustard)" },
};

/** Cobalt section label — heads a group of panels ("Upgrades"). */
export function SectionPill({
  children,
  icon,
  count,
  tone = "cobalt",
  size = "md",
  className,
}: SectionPillProps) {
  return (
    <span
      className={clsx("ui-pill", `ui-pill--${size}`, "font-bold tracking-[0.01em]", className)}
      style={{ ...SECTION_TONE[tone], boxShadow: "2px 2px 0 var(--shadow-ink)" }}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span className="font-mono text-[0.85em] font-semibold opacity-80">{count}</span>
      )}
    </span>
  );
}

/* ─── StatusPill ──────────────────────────────────────────────────────────── */

export type StatusKind =
  | "todo"
  | "doing"
  | "review"
  | "done"
  | "nothing"
  | "error"
  | "info";

/** Fill colour per status (spec §3) and the ink that sits on top of it. */
export const STATUS_COLOR: Record<StatusKind, { fill: string; on: string; text: string }> = {
  todo: { fill: "var(--ink-3)", on: "var(--on-ink)", text: "var(--ink-2)" },
  doing: { fill: "var(--orange)", on: "var(--on-orange)", text: "var(--orange-text)" },
  review: { fill: "var(--mustard)", on: "var(--on-mustard)", text: "var(--mustard-text)" },
  done: { fill: "var(--green)", on: "var(--on-green)", text: "var(--green-text)" },
  nothing: { fill: "var(--ink-3)", on: "var(--on-ink)", text: "var(--ink-3)" },
  error: { fill: "var(--red)", on: "var(--on-red)", text: "var(--red-text)" },
  info: { fill: "var(--cobalt)", on: "var(--on-cobalt)", text: "var(--cobalt-text)" },
};

export interface StatusPillProps {
  status: StatusKind;
  children: ReactNode;
  /** Replaces the dot. */
  icon?: ReactNode;
  /** Pulsing ring on the dot — an agent is working right now. */
  live?: boolean;
  /** `soft` = panel with a coloured dot; `solid` = flooded with the status colour. */
  variant?: "soft" | "solid";
  size?: "sm" | "md";
  className?: string;
}

/** Status line with a dot: "● Waiting for review", "◉ running". */
export function StatusPill({
  status,
  children,
  icon,
  live = false,
  variant = "soft",
  size = "sm",
  className,
}: StatusPillProps) {
  const c = STATUS_COLOR[status];
  const solid = variant === "solid";
  return (
    <span
      className={clsx("ui-pill", `ui-pill--${size}`, className)}
      style={
        solid
          ? { background: c.fill, color: c.on }
          : { background: "var(--panel)", color: "var(--ink)" }
      }
    >
      {icon ?? (
        <span
          aria-hidden
          className={clsx(
            "ui-dot",
            status === "nothing" && "ui-dot--hatched",
            live && "ui-dot--live",
          )}
          style={
            {
              "--dot": solid ? c.on : c.fill,
              ...(solid ? { borderColor: c.on } : null),
            } as CSSProperties
          }
        />
      )}
      {children}
    </span>
  );
}

/* ─── Priority ────────────────────────────────────────────────────────────── */

export type PriorityLevel = "low" | "medium" | "high" | "critical";

const PRIORITY: Record<PriorityLevel, { n: number; color: string }> = {
  low: { n: 1, color: "var(--ink-3)" },
  medium: { n: 2, color: "var(--cobalt)" },
  high: { n: 3, color: "var(--orange)" },
  critical: { n: 4, color: "var(--red)" },
};

/**
 * Priority as filled notches out of four (▲, ▲▲, ▲▲▲, ▲▲▲▲) — see plan §11.
 * Shape carries the meaning, colour reinforces it.
 */
export function PriorityMark({
  level,
  label,
  showLabel = false,
  className,
}: {
  level: PriorityLevel;
  /** Accessible / visible text; defaults to the level key. */
  label?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const p = PRIORITY[level];
  const text = label ?? level;
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5", className)}
      title={text}
      aria-label={showLabel ? undefined : text}
      role={showLabel ? undefined : "img"}
    >
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <svg key={i} width="8" height="9" viewBox="0 0 8 9">
            <path
              d="M4 1L7.2 8H0.8z"
              strokeWidth="1.4"
              strokeLinejoin="round"
              stroke={i < p.n ? "var(--line)" : "var(--ink-3)"}
              strokeOpacity={i < p.n ? 1 : 0.45}
              fill={i < p.n ? p.color : "transparent"}
            />
          </svg>
        ))}
      </span>
      {showLabel && (
        <span className="font-mono text-[11px] font-semibold tracking-[0.02em] text-ink-2">
          {text}
        </span>
      )}
    </span>
  );
}
