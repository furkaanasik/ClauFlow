"use client";

import clsx from "clsx";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tablist. */
  label: string;
  /** id prefix used to wire `aria-controls` → `${idBase}-panel-${value}`. */
  idBase?: string;
  /** Right-aligned extras inside the tab rail. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Folder tabs on a 2px rule. Active tab is a panel-coloured tab with a mustard
 * cap; ←/→/Home/End move between tabs.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  trailing,
  className,
}: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const cur = items.findIndex((i) => i.value === value);
    let next = cur;
    if (e.key === "ArrowRight") next = (cur + 1) % items.length;
    if (e.key === "ArrowLeft") next = (cur - 1 + items.length) % items.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = items.length - 1;
    onChange(items[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className={clsx("ui-tabs", className)}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex items-end gap-1">
        {items.map((it, i) => {
          const active = it.value === value;
          return (
            <button
              key={it.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={idBase ? `${idBase}-tab-${it.value}` : undefined}
              aria-controls={idBase ? `${idBase}-panel-${it.value}` : undefined}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(it.value)}
              className="ui-tab"
            >
              {it.icon}
              {it.label}
              {it.count !== undefined && <span className="ui-tab__count">{it.count}</span>}
            </button>
          );
        })}
      </div>
      {trailing && <div className="ml-auto flex items-center gap-2 pb-1.5">{trailing}</div>}
    </div>
  );
}
