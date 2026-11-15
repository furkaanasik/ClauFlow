import clsx from "clsx";
import type { ComponentPropsWithRef, ReactNode } from "react";

export interface PanelProps extends Omit<ComponentPropsWithRef<"section">, "title"> {
  title?: ReactNode;
  /** Glyph shown in a small mustard plate before the title. */
  icon?: ReactNode;
  /** Top-right slot — typically a DotMeter. */
  meter?: ReactNode;
  /** Header actions (after the meter). */
  actions?: ReactNode;
  tone?: "panel" | "sunken";
  /** Hard offset shadow. Default true for `panel`, false for `sunken`. */
  raised?: boolean;
  /** Lifts on hover, sinks on press (for clickable cards). */
  interactive?: boolean;
  /** Body padding. */
  padding?: "none" | "sm" | "md";
}

const PAD = { none: "", sm: "p-3", md: "p-4" } as const;

/** Ruled card. Optional header with icon plate, title and a right-hand meter. */
export function Panel({
  title,
  icon,
  meter,
  actions,
  tone = "panel",
  raised,
  interactive = false,
  padding = "md",
  className,
  children,
  ...rest
}: PanelProps) {
  const isRaised = raised ?? tone === "panel";
  const hasHead = title || icon || meter || actions;
  return (
    <section
      className={clsx(
        "ui-panel",
        tone === "sunken" && "ui-panel--sunken",
        isRaised && "ui-panel--raised",
        interactive && "ui-panel--interactive",
        className,
      )}
      {...rest}
    >
      {hasHead && (
        <header className="ui-panel__head">
          {icon && <span className="ui-panel__icon" aria-hidden>{icon}</span>}
          {title && <h3 className="ui-panel__title min-w-0 flex-1 truncate">{title}</h3>}
          {!title && <span className="flex-1" />}
          {meter}
          {actions}
        </header>
      )}
      <div className={PAD[padding]}>{children}</div>
    </section>
  );
}

export interface TileProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  meter?: ReactNode;
  /** Small line under the value ("+3 today"). */
  hint?: ReactNode;
  /** Accent stripe on the left edge. */
  accent?: string;
  className?: string;
}

/** Compact stat card: label, big mono value, optional meter. */
export function Tile({ label, value, icon, meter, hint, accent, className }: TileProps) {
  return (
    <div
      className={clsx("ui-panel ui-panel--raised flex min-w-0 flex-col gap-2 overflow-hidden p-3.5", className)}
      style={accent ? { boxShadow: `inset 5px 0 0 ${accent}, var(--shadow)` } : undefined}
    >
      <div className={clsx("flex items-center gap-2", accent && "pl-1.5")}>
        {icon && <span className="text-ink-2" aria-hidden>{icon}</span>}
        <span className="t-label min-w-0 flex-1 truncate !text-ink-2">{label}</span>
        {meter}
      </div>
      <div className={clsx("font-mono text-[28px] font-semibold leading-none tracking-tight text-ink", accent && "pl-1.5")}>
        {value}
      </div>
      {hint && <div className={clsx("text-xs text-ink-3", accent && "pl-1.5")}>{hint}</div>}
    </div>
  );
}
