"use client";

import { useId } from "react";
import { Select } from "@/components/ui/Input";
import { IconLock, IconTeam } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { useTeams } from "@/hooks/useTeams";
import type { Project, Team } from "@/types";
import { RoleChain } from "./RoleChain";
import { fill, resolveTeam, teamDescription, teamName } from "./roleMeta";

interface TeamPickerProps {
  project: Pick<Project, "id" | "defaultTeamId"> | null;
  /** Task-level choice; null = project default. */
  value: string | null;
  onChange: (teamId: string | null) => void;
  /** Running and finished tasks keep their team. */
  locked?: boolean;
  /** Why it is locked; defaults to the "while it runs" line. */
  lockedReason?: string;
  /** Re-fetch teams when this changes (e.g. the modal opening). */
  refreshKey?: unknown;
  /** Hide the visible label (the caller renders its own). */
  hideLabel?: boolean;
  size?: "sm" | "md";
  error?: string | null;
}

/**
 * "Bu görevi kim yapsın?": a native select (keyboard + mobile behaviour) whose first
 * option follows the project default, then built-ins, user templates and project
 * teams. The chosen team's role order and description sit under it.
 */
export function TeamPicker({ project, value, onChange, locked, lockedReason, refreshKey, hideLabel, size = "sm", error }: TeamPickerProps) {
  const t = useTranslation();
  const tp = t.team.picker;
  const id = useId();
  const { teams, loading } = useTeams(project?.id, refreshKey);

  const defaultTeam = resolveTeam(teams, null, project);
  const effective = resolveTeam(teams, value, project);
  const builtins = teams.filter((x) => x.builtin);
  const templates = teams.filter((x) => !x.builtin && x.projectId === null);
  const own = teams.filter((x) => !x.builtin && x.projectId !== null);
  // A stale id (team deleted elsewhere) still shows as selected until changed.
  const known = value == null || teams.some((x) => x.id === value);

  const group = (label: string, list: Team[]) =>
    list.length > 0 && (
      <optgroup label={label}>
        {list.map((team) => (
          <option key={team.id} value={team.id}>
            {teamName(team, t)}
          </option>
        ))}
      </optgroup>
    );

  const noteId = `${id}-note`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!hideLabel && (
        <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <IconTeam size={14} className="text-ink-2" />
          {tp.label}
        </label>
      )}
      <Select
        id={id}
        size={size}
        aria-label={hideLabel ? tp.label : undefined}
        aria-describedby={noteId}
        value={value ?? ""}
        disabled={locked || (loading && teams.length === 0)}
        onChange={(e) => onChange(e.target.value || null)}
        invalid={Boolean(error)}
      >
        <option value="">
          {fill(tp.projectDefault, { name: defaultTeam ? teamName(defaultTeam, t) : "Solo" })}
        </option>
        {!known && value && <option value={value}>{value}</option>}
        {group(tp.groupBuiltin, builtins)}
        {group(tp.groupTemplates, templates)}
        {group(tp.groupProject, own)}
      </Select>
      <div id={noteId} className="flex flex-col gap-1.5">
        {loading && teams.length === 0 ? (
          <p className="font-mono text-[11.5px] text-ink-3">{tp.loading}</p>
        ) : effective ? (
          <>
            <RoleChain roles={effective.roles} />
            <p className="text-[12px] leading-snug text-ink-3">{teamDescription(effective, t)}</p>
          </>
        ) : null}
        {locked && (
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
            <IconLock size={12} className="shrink-0" />
            {lockedReason ?? tp.locked}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px] font-medium text-[var(--red-text)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
