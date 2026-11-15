"use client";

import clsx from "clsx";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Accessible name for the group. */
  label: string;
  className?: string;
}

/**
 * One-of-n switch. Active segment is mustard; optional counter badge per
 * segment ("Outgoing 1 | Incoming 2"). Arrow keys move the selection.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  label,
  className,
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    const cur = enabled.indexOf(options.findIndex((o) => o.value === value));
    let next = cur;
    if (e.key === "ArrowRight") next = (cur + 1) % enabled.length;
    if (e.key === "ArrowLeft") next = (cur - 1 + enabled.length) % enabled.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = enabled.length - 1;
    const idx = enabled[next];
    onChange(options[idx].value);
    refs.current[idx]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={clsx("ui-seg", `ui-seg--${size}`, className)}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className="ui-seg__item disabled:cursor-not-allowed disabled:opacity-40"
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && <span className="ui-seg__count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
