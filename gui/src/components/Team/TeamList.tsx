"use client";

import clsx from "clsx";
import { useTranslation } from "@/hooks/useTranslation";
import { IconCheck } from "@/components/ui/icons";
import type { Team } from "@/types";
import { RolePlate } from "./RoleChain";
import { teamDescription, teamName } from "./roleMeta";

interface TeamListProps {
  teams: Team[];
  selectedId: string | null;
  defaultId: string;
  onSelect: (id: string) => void;
}

/** Template cards grouped as built-ins, user templates and the project's own teams. */
export function TeamList({ teams, selectedId, defaultId, onSelect }: TeamListProps) {
  const t = useTranslation();
  const te = t.team.editor;
  const groups: { key: string; label: string; list: Team[]; empty?: string }[] = [
    { key: "builtin", label: t.team.picker.groupBuiltin, list: teams.filter((x) => x.builtin) },
    {
      key: "templates",
      label: t.team.picker.groupTemplates,
      list: teams.filter((x) => !x.builtin && x.projectId === null),
      empty: te.emptyTemplates,
    },
    {
      key: "project",
      label: t.team.picker.groupProject,
      list: teams.filter((x) => !x.builtin && x.projectId !== null),
      empty: te.emptyProject,
    },
  ];

  return (
    <nav aria-label={te.listLabel} className="flex min-w-0 flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <header className="ui-sechead !mb-2">
            <span className="ui-sechead__t">{g.label}</span>
            <span className="ui-sechead__n">{g.list.length}</span>
          </header>
          {g.list.length === 0 ? (
            g.empty && (
              <p className="ui-hatch rounded-[10px] border-2 border-dashed border-hair px-3 py-2.5 text-[12px] leading-snug text-ink-3">
                {g.empty}
              </p>
            )
          ) : (
            <ul className="flex flex-col gap-2">
              {g.list.map((team) => {
                const selected = team.id === selectedId;
                const isDefault = team.id === defaultId;
                return (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(team.id)}
                      aria-current={selected ? "true" : undefined}
                      data-checked={selected ? "true" : undefined}
                      className={clsx("ui-option !items-start !gap-3 !py-2.5")}
                    >
                      <span aria-hidden className="mt-0.5 flex shrink-0 -space-x-1">
                        {team.roles.map((r) => (
                          <RolePlate key={r.id} kind={r.kind} />
                        ))}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="min-w-0 break-words text-[13.5px] font-bold text-ink">{teamName(team, t)}</span>
                          {isDefault && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-pill border-[1.5px] border-line bg-green px-1.5 font-mono text-[9.5px] font-bold uppercase leading-[16px] tracking-[0.06em] text-[var(--on-green)]">
                              <IconCheck size={9} />
                              {te.defaultBadge}
                            </span>
                          )}
                        </span>
                        <span className="line-clamp-2 text-[12px] leading-snug text-ink-2">
                          {teamDescription(team, t) || "—"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </nav>
  );
}
