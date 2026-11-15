"use client";

import clsx from "clsx";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button, IconButton } from "@/components/ui/Button";
import { IconAlert, IconChevronDown, IconChevronUp, IconPlus, IconRetry, IconTrash } from "@/components/ui/icons";
import type { RoleKind, TeamRole } from "@/types";
import { RolePlate } from "./RoleChain";
import { ROLE_KINDS, ROLE_TONE, fill, roleLabel } from "./roleMeta";
import type { DraftIssue } from "./teamDraft";

interface RoleListProps {
  roles: TeamRole[];
  selected: number;
  onSelect: (index: number) => void;
  /** Absent in read-only mode. */
  onMove?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  onAdd?: (kind: RoleKind) => void;
  issues: DraftIssue[];
  advisorEnabled: boolean;
}

/**
 * Ordered role list. Roles run top to bottom; the QA → Developer loop is drawn
 * between the two. Editable: up/down buttons, remove, and "+ <kind>" for missing kinds.
 */
export function RoleList({ roles, selected, onSelect, onMove, onRemove, onAdd, issues, advisorEnabled }: RoleListProps) {
  const t = useTranslation();
  const te = t.team.editor;
  const editable = Boolean(onMove);
  const missing = ROLE_KINDS.filter((k) => !roles.some((r) => r.kind === k));
  const teamIssues = issues.filter((i) => i.roleIndex === null);
  const roleIssues = issues.filter((i) => i.roleIndex !== null);

  // Keyboard: a moved row keeps focus on its control, unless that control just
  // became disabled (row hit the top/bottom) — then focus the opposite arrow.
  // A removed row hands focus to its neighbour. Each change is announced.
  const listRef = useRef<HTMLOListElement>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (!pendingFocus) return;
    const el = listRef.current?.parentElement?.querySelector<HTMLElement>(`[data-role-focus="${pendingFocus}"]`);
    if (el && document.activeElement !== el) el.focus();
    setPendingFocus(null);
  }, [pendingFocus, roles]);

  const move = (i: number, to: number) => {
    const role = roles[i];
    onMove!(i, to);
    const atEdge = to === 0 || to === roles.length - 1;
    const goingUp = to < i;
    if (atEdge) setPendingFocus(`${role.id}:${goingUp ? "down" : "up"}`);
    setAnnounce(fill(te.roleMoved, { name: roleLabel(role, role.kind, t), n: to + 1 }));
  };
  const remove = (i: number) => {
    const role = roles[i];
    onRemove!(i);
    const next = roles[i + 1] ?? roles[i - 1];
    setPendingFocus(next ? `${next.id}:select` : "add");
    setAnnounce(fill(te.roleRemoved, { name: roleLabel(role, role.kind, t) }));
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <header className="ui-sechead !mb-0">
        <span className="ui-sechead__t">{te.roles}</span>
        <span className="ui-sechead__n">{roles.length}/4</span>
      </header>

      <ol ref={listRef} className="flex flex-col">
        {roles.map((role, i) => {
          const loop = role.kind === "qa" && roles[i - 1]?.kind === "developer";
          const hasIssue = roleIssues.some((x) => x.roleIndex === i);
          const isSel = i === selected;
          return (
            <Fragment key={role.id}>
              {i > 0 && (
                <li aria-hidden className="flex h-4 items-center pl-[1.55rem] text-ink-3">
                  {loop ? (
                    <span className="inline-flex text-[var(--green-text)]">
                      <IconRetry size={12} />
                    </span>
                  ) : (
                    <span className="h-full border-l-2 border-dashed border-hair" />
                  )}
                </li>
              )}
              <li
                className={clsx(
                  "group flex items-center gap-1 rounded-[10px] border-2 bg-panel pr-1 transition-[box-shadow,transform] duration-100",
                  isSel ? "border-line" : "border-hair hover:border-line",
                )}
                style={
                  isSel
                    ? { boxShadow: `inset 4px 0 0 ${ROLE_TONE[role.kind].fill}, 3px 3px 0 var(--shadow-ink)` }
                    : { boxShadow: `inset 4px 0 0 ${ROLE_TONE[role.kind].fill}` }
                }
              >
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  data-role-focus={`${role.id}:select`}
                  aria-current={isSel ? "true" : undefined}
                  className="ui-focus flex min-w-0 flex-1 items-center gap-2.5 rounded-[8px] py-2 pl-3 pr-1 text-left"
                >
                  <span className="w-3 shrink-0 font-mono text-[11px] font-bold text-ink-3">{i + 1}</span>
                  <RolePlate kind={role.kind} size="md" />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="flex items-center gap-1.5 truncate text-[13.5px] font-bold text-ink">
                      {roleLabel(role, role.kind, t)}
                      {hasIssue && <IconAlert size={13} className="shrink-0 text-[var(--red-text)]" />}
                    </span>
                    <span
                      className="truncate font-mono text-[11px] text-ink-3"
                      title={advisorEnabled && role.advisorModel ? `${te.model}: ${role.model} · ${te.advisor}: ${role.advisorModel}` : undefined}
                    >
                      {role.model}
                      {advisorEnabled && role.advisorModel ? ` + ${role.advisorModel}` : ""}
                    </span>
                  </span>
                </button>
                {editable && (
                  <span className="flex shrink-0 items-center">
                    <IconButton
                      label={`${te.moveUp}: ${roleLabel(role, role.kind, t)}`}
                      size="sm"
                      variant="ghost"
                      disabled={i === 0}
                      data-role-focus={`${role.id}:up`}
                      onClick={() => move(i, i - 1)}
                    >
                      <IconChevronUp size={13} />
                    </IconButton>
                    <IconButton
                      label={`${te.moveDown}: ${roleLabel(role, role.kind, t)}`}
                      size="sm"
                      variant="ghost"
                      disabled={i === roles.length - 1}
                      data-role-focus={`${role.id}:down`}
                      onClick={() => move(i, i + 1)}
                    >
                      <IconChevronDown size={13} />
                    </IconButton>
                    <IconButton
                      label={`${te.removeRole}: ${roleLabel(role, role.kind, t)}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(i)}
                    >
                      <IconTrash size={13} />
                    </IconButton>
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>

      {editable && onAdd && (
        <div className="flex flex-col gap-1.5">
          <span className="t-label !text-[10px]">{te.addRole}</span>
          {missing.length === 0 ? (
            <p className="text-[12px] text-ink-3">{te.addRoleNone}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {missing.map((kind, k) => (
                <Button
                  key={kind}
                  size="sm"
                  variant="secondary"
                  icon={<IconPlus size={12} />}
                  onClick={() => onAdd(kind)}
                  data-role-focus={k === 0 ? "add" : undefined}
                >
                  {t.team.roles[kind]}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {(teamIssues.length > 0 || roleIssues.length > 0) && (
        <div role="alert" className="ui-banner ui-banner--error !py-2">
          <IconAlert size={14} className="mt-0.5 shrink-0" />
          <ul className="flex flex-col gap-0.5 text-[12.5px]">
            {[...teamIssues, ...roleIssues].map((issue, k) => {
              const role = issue.roleIndex !== null ? roles[issue.roleIndex] : null;
              return (
                <li key={`${issue.code}-${issue.roleIndex}-${k}`}>
                  {role && <span className="font-semibold">{roleLabel(role, role.kind, t)}: </span>}
                  {te.validation[issue.code]}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
