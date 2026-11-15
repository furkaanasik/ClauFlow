import type { ReactNode } from "react";
import { IconBriefcase, IconClipboard, IconCode, IconShieldCheck } from "@/components/ui/icons";
import type { Translations } from "@/lib/i18n/types";
import type { AgentState, Project, RoleKind, Team, TeamRole } from "@/types";

export const ROLE_KINDS: RoleKind[] = ["ceo", "analyst", "developer", "qa"];

/** Fill + ink per role, from the shared palette (both themes pass contrast). */
export const ROLE_TONE: Record<RoleKind, { fill: string; on: string; text: string }> = {
  ceo: { fill: "var(--cobalt)", on: "var(--on-cobalt)", text: "var(--cobalt-text)" },
  analyst: { fill: "var(--mustard)", on: "var(--on-mustard)", text: "var(--mustard-text)" },
  developer: { fill: "var(--orange)", on: "var(--on-orange)", text: "var(--orange-text)" },
  qa: { fill: "var(--green)", on: "var(--on-green)", text: "var(--green-text)" },
};

export function roleIcon(kind: RoleKind, size = 14): ReactNode {
  switch (kind) {
    case "ceo":
      return <IconBriefcase size={size} />;
    case "analyst":
      return <IconClipboard size={size} />;
    case "developer":
      return <IconCode size={size} />;
    case "qa":
      return <IconShieldCheck size={size} />;
  }
}

export function isRoleKind(v: unknown): v is RoleKind {
  return typeof v === "string" && (ROLE_KINDS as string[]).includes(v);
}

/** `agent.currentStep = "team:<kind>"` → the active role, else null. */
export function teamStepKind(step: string | undefined | null): RoleKind | null {
  if (!step || !step.startsWith("team:")) return null;
  const kind = step.slice(5);
  return isRoleKind(kind) ? kind : null;
}

/** Built-in role names are stored in Turkish; show the translated kind name for those. */
const DEFAULT_ROLE_NAMES: Record<RoleKind, string> = {
  ceo: "CEO",
  analyst: "Analist",
  developer: "Yazılımcı",
  qa: "QA",
};

export function roleLabel(role: Pick<TeamRole, "kind" | "name"> | null | undefined, kind: RoleKind, t: Translations): string {
  if (!role || !role.name || role.name === DEFAULT_ROLE_NAMES[kind]) return t.team.roles[kind];
  return role.name;
}

type BuiltinKey = keyof Translations["team"]["builtinNames"];

function builtinKey(team: Team): BuiltinKey | null {
  if (!team.builtin || !team.templateKey) return null;
  return team.templateKey in DEFAULT_TEAM_KEYS ? (team.templateKey as BuiltinKey) : null;
}

const DEFAULT_TEAM_KEYS: Record<BuiltinKey, true> = { solo: true, yazilim_ekibi: true, hata_avi: true, kesif: true };

export function teamName(team: Team, t: Translations): string {
  const key = builtinKey(team);
  return key ? t.team.builtinNames[key] : team.name;
}

export function teamDescription(team: Team, t: Translations): string {
  const key = builtinKey(team);
  return key ? t.team.builtinDescriptions[key] : team.description;
}

export const SOLO_TEAM_ID = "team_solo";

/** Task → project → Solo, mirroring core `resolveTeamForTask`. */
export function resolveTeam(
  teams: Team[],
  teamId: string | null | undefined,
  project: Pick<Project, "defaultTeamId"> | null | undefined,
): Team | null {
  const byId = (id: string | null | undefined) => (id ? teams.find((x) => x.id === id) ?? null : null);
  return byId(teamId) ?? byId(project?.defaultTeamId) ?? byId(SOLO_TEAM_ID);
}

/** "{n}" placeholder helper. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/**
 * Live label for an agent: "QA kontrol ediyor · tur 2" while a team role runs,
 * otherwise the plain executor step ("Ajan yazıyor", "Onay bekliyor" …).
 * `qaRound` = failed QA rounds so far (`TeamRun.qaRound`); the active round is +1.
 */
export function agentStepLabel(agent: Pick<AgentState, "status" | "currentStep">, t: Translations, qaRound = 0): string {
  const kind = agent.status === "running" ? teamStepKind(agent.currentStep) : null;
  if (!kind) return t.taskCard.agentSteps[agent.status] ?? agent.status;
  const loop = qaRound > 0 && (kind === "developer" || kind === "qa");
  return loop ? `${t.team.activity[kind]} ${fill(t.team.roundSuffix, { n: qaRound + 1 })}` : t.team.activity[kind];
}
