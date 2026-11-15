"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { Input, Select } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Toggle";
import { IconCheck, IconGear, IconRetry, IconShieldCheck, IconTeam } from "@/components/ui/icons";
import type { Project, ProjectPatch, Team } from "@/types";
import { RoleChain } from "./RoleChain";
import { SOLO_TEAM_ID, resolveTeam, teamName } from "./roleMeta";

type RoundPreset = "1" | "2" | "3" | "5" | "0" | "custom";
const PRESETS: RoundPreset[] = ["1", "2", "3", "5", "0"];

interface TeamSettingsProps {
  project: Project;
  teams: Team[];
}

/**
 * Project-level team settings: the default team, the QA round limit (0 = Sınırsız)
 * and the spec-approval gate. Each control saves on change (PATCH /api/projects/:id).
 */
export function TeamSettings({ project, teams }: TeamSettingsProps) {
  const t = useTranslation();
  const te = t.team.editor;
  const updateProjectLocal = useBoardStore((s) => s.updateProject);
  const id = useId();
  const [flash, setFlash] = useState<"saved" | "error" | null>(null);
  const [busy, setBusy] = useState(false);

  const rounds = project.qaMaxRounds ?? 3;
  const [roundsText, setRoundsText] = useState(String(rounds));
  useEffect(() => setRoundsText(String(rounds)), [rounds]);

  const save = async (patch: ProjectPatch) => {
    setBusy(true);
    setFlash(null);
    const previous: ProjectPatch = {
      defaultTeamId: project.defaultTeamId ?? null,
      qaMaxRounds: project.qaMaxRounds,
      specApproval: project.specApproval,
    };
    updateProjectLocal(project.id, patch);
    try {
      const saved = await api.updateProject(project.id, patch);
      updateProjectLocal(project.id, {
        defaultTeamId: saved.defaultTeamId ?? null,
        qaMaxRounds: saved.qaMaxRounds,
        specApproval: saved.specApproval,
      });
      setFlash("saved");
      setTimeout(() => setFlash((f) => (f === "saved" ? null : f)), 2500);
    } catch {
      updateProjectLocal(project.id, previous);
      setFlash("error");
    } finally {
      setBusy(false);
    }
  };

  const defaultTeam = resolveTeam(teams, null, project);
  const preset: RoundPreset = (PRESETS as string[]).includes(String(rounds)) ? (String(rounds) as RoundPreset) : "custom";

  const commitRounds = () => {
    const n = Number(roundsText);
    if (!Number.isInteger(n) || n < 0 || n > 20) {
      setRoundsText(String(rounds));
      return;
    }
    if (n !== rounds) void save({ qaMaxRounds: n });
  };

  const builtins = teams.filter((x) => x.builtin);
  const templates = teams.filter((x) => !x.builtin && x.projectId === null);
  const own = teams.filter((x) => !x.builtin && x.projectId !== null);

  return (
    <section className="ui-panel ui-panel--raised" aria-labelledby={`${id}-title`}>
      <header className="flex items-center gap-2.5 border-b-2 border-line px-4 py-2.5">
        <span aria-hidden className="ui-panel__icon !h-7 !w-7" style={{ boxShadow: "2px 2px 0 var(--shadow-ink)" }}>
          <IconGear size={14} />
        </span>
        <h3 id={`${id}-title`} className="ui-panel__title">
          {te.settingsTitle}
        </h3>
        <span aria-live="polite" className="ml-auto text-[12px] font-semibold">
          {flash === "saved" && (
            <span className="inline-flex items-center gap-1 text-[var(--green-text)]">
              <IconCheck size={12} />
              {te.settingSaved}
            </span>
          )}
          {flash === "error" && <span className="text-[var(--red-text)]">{te.settingError}</span>}
        </span>
      </header>

      <div className="grid gap-x-6 gap-y-5 px-4 py-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* Default team */}
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={`${id}-default`} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <IconTeam size={14} className="text-ink-2" />
            {te.defaultTeam}
          </label>
          <Select
            id={`${id}-default`}
            size="sm"
            value={project.defaultTeamId ?? SOLO_TEAM_ID}
            disabled={busy || teams.length === 0}
            onChange={(e) => void save({ defaultTeamId: e.target.value })}
            aria-describedby={`${id}-default-hint`}
          >
            {[
              [t.team.picker.groupBuiltin, builtins] as const,
              [t.team.picker.groupTemplates, templates] as const,
              [t.team.picker.groupProject, own] as const,
            ].map(([label, list]) =>
              list.length > 0 ? (
                <optgroup key={label} label={label}>
                  {list.map((team) => (
                    <option key={team.id} value={team.id}>
                      {teamName(team, t)}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </Select>
          {defaultTeam && <RoleChain roles={defaultTeam.roles} />}
          <p id={`${id}-default-hint`} className="text-[12px] leading-snug text-ink-3">
            {te.defaultTeamHint}
          </p>
        </div>

        {/* QA round limit */}
        <div className="flex min-w-0 flex-col gap-2">
          <span id={`${id}-rounds`} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <IconRetry size={14} className="text-ink-2" />
            {te.qaRounds}
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented<RoundPreset>
              label={te.qaRounds}
              size="sm"
              value={preset}
              onChange={(v) => {
                if (v !== "custom") void save({ qaMaxRounds: Number(v) });
              }}
              options={PRESETS.map((p) => ({ value: p, label: p === "0" ? te.unlimited : p }))}
            />
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">{te.qaRoundsCustom}</span>
              <Input
                size="sm"
                type="number"
                inputMode="numeric"
                min={0}
                max={20}
                value={roundsText}
                title={te.qaRoundsCustom}
                disabled={busy}
                onChange={(e) => setRoundsText(e.target.value)}
                onBlur={commitRounds}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRounds();
                }}
                className="!w-[4.25rem] font-mono"
              />
            </label>
          </div>
          <p className="text-[12px] leading-snug text-ink-3">{te.qaRoundsHint}</p>
        </div>

        {/* Spec approval */}
        <div className="flex min-w-0 flex-col gap-2">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <IconShieldCheck size={14} className="text-ink-2" />
            {te.specApproval}
          </span>
          <div className="flex items-start gap-3">
            <Switch
              checked={Boolean(project.specApproval)}
              onCheckedChange={(next) => void save({ specApproval: next })}
              label={te.specApproval}
              disabled={busy}
              aria-describedby={`${id}-spec-hint`}
            />
            <p id={`${id}-spec-hint`} className="text-[12px] leading-snug text-ink-3">
              {te.specApprovalHint}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
