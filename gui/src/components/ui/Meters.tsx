import clsx from "clsx";
import type { ReactNode } from "react";

/* ─── DotMeter ●●●○○ ──────────────────────────────────────────────────────── */

export interface DotMeterProps {
  value: number;
  max?: number;
  /** Fill colour of the lit dots (any CSS colour / token var). */
  color?: string;
  size?: "sm" | "md" | "lg";
  /** Accessible name, e.g. "Budget used". */
  label?: string;
  className?: string;
}

const DOT_PX = { sm: 8, md: 11, lg: 14 } as const;

/** Discrete meter: `value` of `max` dots lit. Fractions round to nearest. */
export function DotMeter({
  value,
  max = 5,
  color = "var(--mustard)",
  size = "md",
  label,
  className,
}: DotMeterProps) {
  const lit = Math.max(0, Math.min(max, Math.round(value)));
  const px = DOT_PX[size];
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={lit}
      className={clsx("inline-flex items-center", className)}
      style={{ gap: Math.max(3, px * 0.4) }}
    >
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block rounded-full"
          style={{
            width: px,
            height: px,
            border: `${size === "sm" ? 1.5 : 2}px solid var(--line)`,
            background: i < lit ? color : "var(--sunken)",
            boxShadow: i < lit ? "none" : "inset 1px 1px 0 color-mix(in srgb, var(--ink) 12%, transparent)",
          }}
        />
      ))}
    </span>
  );
}

/* ─── RingGauge ───────────────────────────────────────────────────────────── */

export interface RingGaugeProps {
  value: number;
  max?: number;
  /** Diameter in px. */
  size?: number;
  /** Ring thickness in px. */
  thickness?: number;
  color?: string;
  /** Centre content; defaults to the percentage. */
  children?: ReactNode;
  /** Caption under the gauge ("4 / min"). */
  label?: ReactNode;
  sublabel?: ReactNode;
  className?: string;
  /** Accessible name. */
  ariaLabel?: string;
}

/**
 * Circular progress with a printed look: ink rim, sunken track, hard offset
 * shadow disc, flat-capped arc.
 */
export function RingGauge({
  value,
  max = 100,
  size = 88,
  thickness = 10,
  color = "var(--mustard)",
  children,
  label,
  sublabel,
  className,
  ariaLabel,
}: RingGaugeProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const stroke = 2;
  const c = size / 2;
  const outer = c - stroke / 2 - 3; // leave room for the shadow offset
  const mid = outer - stroke / 2 - thickness / 2;
  const inner = outer - stroke / 2 - thickness; // inner rim sits on the arc edge
  const circ = 2 * Math.PI * mid;

  return (
    <figure className={clsx("inline-flex flex-col items-center gap-2", className)}>
      <div
        role="meter"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="relative"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          {/* hard shadow disc */}
          <circle cx={c + 3} cy={c + 3} r={outer} fill="var(--shadow-ink)" />
          {/* track */}
          <circle cx={c} cy={c} r={outer} fill="var(--sunken)" stroke="var(--line)" strokeWidth={stroke} />
          {/* arc */}
          <circle
            cx={c}
            cy={c}
            r={mid}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${circ} ${circ}`}
            strokeDashoffset={circ * (1 - pct)}
            transform={`rotate(-90 ${c} ${c})`}
            style={{ transition: "stroke-dashoffset 600ms cubic-bezier(.3,.7,.4,1)" }}
          />
          {/* tick at the arc head */}
          {pct > 0 && pct < 1 && (
            <line
              x1={c}
              y1={c - outer}
              x2={c}
              y2={c - inner}
              stroke="var(--line)"
              strokeWidth={stroke}
              transform={`rotate(${pct * 360} ${c} ${c})`}
            />
          )}
          {/* inner face */}
          <circle cx={c} cy={c} r={inner} fill="var(--panel)" stroke="var(--line)" strokeWidth={stroke} />
        </svg>
        <div
          className="absolute inset-0 grid place-items-center font-mono font-semibold text-ink"
          style={{ fontSize: Math.max(11, size * 0.2), paddingRight: 3, paddingBottom: 3 }}
        >
          {children ?? `${Math.round(pct * 100)}%`}
        </div>
      </div>
      {(label || sublabel) && (
        <figcaption className="text-center leading-tight">
          {label && <div className="text-[13px] font-semibold text-ink">{label}</div>}
          {sublabel && <div className="font-mono text-[11px] text-ink-3">{sublabel}</div>}
        </figcaption>
      )}
    </figure>
  );
}
