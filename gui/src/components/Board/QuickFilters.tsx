"use client";

import clsx from "clsx";
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { PriorityMark, type PriorityLevel } from "@/components/ui/Pills";
import { IconBolt, IconCheck, IconChevronDown, IconClose, IconPR, IconTag } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/overlay";
import { useTranslation } from "@/hooks/useTranslation";
import { useViewStore, activeFilterCount } from "@/store/viewStore";
import { hasOpenPR, isAgentWorking, tagCounts, tagDot } from "@/lib/boardView";
import type { Task } from "@/types";

const PRIORITIES: PriorityLevel[] = ["critical", "high", "medium", "low"];

interface QuickFiltersProps {
  /** All tasks of the project (pre-filter) — counts come from here. */
  tasks: Task[];
  shown: number;
}

/** Client-side quick filters: priority, label, agent running, PR open. */
export function QuickFilters({ tasks, shown }: QuickFiltersProps) {
  const t = useTranslation();
  const filters = useViewStore((s) => s.filters);
  const togglePriority = useViewStore((s) => s.togglePriority);
  const toggleTag = useViewStore((s) => s.toggleTag);
  const setAgentRunning = useViewStore((s) => s.setAgentRunning);
  const setPrOpen = useViewStore((s) => s.setPrOpen);
  const clearFilters = useViewStore((s) => s.clearFilters);

  const tags = useMemo(() => tagCounts(tasks), [tasks]);
  const prioCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of tasks) if (x.priority) m[x.priority] = (m[x.priority] ?? 0) + 1;
    return m;
  }, [tasks]);
  const runningCount = tasks.filter(isAgentWorking).length;
  const prCount = tasks.filter(hasOpenPR).length;
  const active = activeFilterCount(filters);

  return (
    <div role="group" aria-label={t.board.filters.label} className="flex flex-wrap items-center gap-2">
      <FilterMenu
        label={t.board.filters.priority}
        icon={<span aria-hidden className="text-[9px] leading-none tracking-[-0.05em]">▲▲▲</span>}
        count={filters.priorities.length}
      >
        {PRIORITIES.map((p) => (
          <MenuCheck
            key={p}
            checked={filters.priorities.includes(p)}
            onToggle={() => togglePriority(p)}
            count={prioCount[p] ?? 0}
          >
            <PriorityMark level={p} label={t.addTask.priorities[p]} />
            <span className="flex-1">{t.addTask.priorities[p]}</span>
          </MenuCheck>
        ))}
      </FilterMenu>

      <FilterMenu label={t.board.filters.tags} icon={<IconTag size={14} />} count={filters.tags.length}>
        {tags.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-3">{t.board.filters.noTags}</p>}
        {tags.map(({ tag, count }) => (
          <MenuCheck
            key={tag}
            checked={filters.tags.includes(tag)}
            onToggle={() => toggleTag(tag)}
            count={count}
          >
            <span aria-hidden className="ui-dot !h-2 !w-2 !border" style={{ "--dot": tagDot(tag) } as CSSProperties} />
            <span className="flex-1 truncate">{tag}</span>
          </MenuCheck>
        ))}
      </FilterMenu>

      <Chip
        selected={filters.agentRunning}
        onSelectedChange={setAgentRunning}
        icon={<IconBolt size={14} />}
        count={runningCount}
      >
        {t.board.filters.agentRunning}
      </Chip>
      <Chip selected={filters.prOpen} onSelectedChange={setPrOpen} icon={<IconPR size={14} />} count={prCount}>
        {t.board.filters.prOpen}
      </Chip>

      {active > 0 && (
        <>
          <Button size="sm" variant="ghost" icon={<IconClose size={13} />} onClick={clearFilters}>
            {t.board.filters.clear}
          </Button>
          <span className="font-mono text-[12px] text-ink-3" aria-live="polite">
            {t.board.filters.showing.replace("{shown}", String(shown)).replace("{total}", String(tasks.length))}
          </span>
        </>
      )}
    </div>
  );
}

function FilterMenu({
  label,
  icon,
  count,
  children,
}: {
  label: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={count > 0 || undefined}
        onClick={() => setOpen((v) => !v)}
        className="ui-chip ui-focus"
      >
        {icon}
        {label}
        {count > 0 && <span className="ui-chip__count">{count}</span>}
        <IconChevronDown size={13} className={clsx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="ui-menu left-0 top-[calc(100%+8px)] w-60 p-1.5">
          <div className="max-h-72 overflow-y-auto">{children}</div>
        </div>
      )}
    </div>
  );
}

function MenuCheck({
  checked,
  onToggle,
  count,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  count: number;
  children: ReactNode;
}) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={onToggle} className="ui-menu__item">
      <span
        aria-hidden
        className="grid h-4 w-4 flex-none place-items-center rounded-[4px] border-2 border-line"
        style={checked ? { background: "var(--ink)", color: "var(--on-ink)" } : { background: "var(--panel)" }}
      >
        {checked && <IconCheck size={10} strokeWidth={3} />}
      </span>
      {children}
      <span className="font-mono text-[11px] text-ink-3">{count}</span>
    </button>
  );
}
