import type { TeamValidationCode } from "@/lib/i18n/types";
import type { RoleKind, Team, TeamRole } from "@/types";
import { ROLE_KINDS } from "./roleMeta";

/** Mirrors core `ROLE_TOOLS` (teamTemplates.ts): the tools a role may be given. */
export const ROLE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TodoWrite",
] as const;

export const MAX_ROLE_SKILLS = 30;

/** Fallback model order (weak → strong) when capabilities haven't loaded. */
export const FALLBACK_MODELS = ["haiku", "sonnet", "opus", "fable"];

/** Rank of a model in the capability list (alias or a full name containing it); -1 = unknown. */
export function modelRank(model: string, models: string[]): number {
  const m = model.toLowerCase();
  for (let i = models.length - 1; i >= 0; i--) {
    if (m.includes(models[i]!.toLowerCase())) return i;
  }
  if (m.includes("mythos")) return models.length - 1;
  return -1;
}

export function isHaiku(model: string): boolean {
  return model.toLowerCase().includes("haiku");
}

/** Advisor choices for a main model: same rank or stronger, never Haiku. */
export function advisorOptions(model: string, models: string[]): string[] {
  const rank = modelRank(model, models);
  return models.filter((m, i) => !isHaiku(m) && i >= Math.max(rank, 0));
}

export interface DraftIssue {
  code: TeamValidationCode;
  /** Role index the issue belongs to, or null for team-level issues. */
  roleIndex: number | null;
}

/** Client-side mirror of core `teamRolesSchema` (+ name checks), so Save can stay disabled. */
export function validateDraft(name: string, roles: TeamRole[], models: string[], advisorEnabled: boolean): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!name.trim()) issues.push({ code: "team_name_required", roleIndex: null });
  if (roles.length === 0) issues.push({ code: "roles_min", roleIndex: null });
  if (roles.length > 4) issues.push({ code: "roles_max", roleIndex: null });
  const seen = new Set<RoleKind>();
  roles.forEach((role, i) => {
    if (seen.has(role.kind)) issues.push({ code: "duplicate_kind", roleIndex: i });
    seen.add(role.kind);
    if (!role.name.trim()) issues.push({ code: "name_required", roleIndex: i });
    if (role.tools.length === 0) issues.push({ code: "tools_min", roleIndex: i });
    if (role.skills.length > MAX_ROLE_SKILLS) issues.push({ code: "skills_max", roleIndex: i });
    if (modelRank(role.model, models) < 0) issues.push({ code: "invalid_model", roleIndex: i });
    if (advisorEnabled && role.advisorModel) {
      if (isHaiku(role.advisorModel)) issues.push({ code: "haiku_advisor", roleIndex: i });
      else if (modelRank(role.advisorModel, models) < modelRank(role.model, models)) {
        issues.push({ code: "advisor_below_model", roleIndex: i });
      }
    }
  });
  const qa = roles.findIndex((r) => r.kind === "qa");
  const dev = roles.findIndex((r) => r.kind === "developer");
  if (qa >= 0) {
    if (dev < 0) issues.push({ code: "qa_requires_developer", roleIndex: qa });
    else if (dev > qa) issues.push({ code: "qa_before_developer", roleIndex: qa });
  }
  return issues;
}

const KNOWN_CODES = new Set<string>([
  "roles_min",
  "roles_max",
  "duplicate_kind",
  "duplicate_role_id",
  "qa_requires_developer",
  "qa_before_developer",
  "advisor_below_model",
  "haiku_advisor",
  "invalid_model",
  "invalid_skill_id",
  "duplicate_tool",
  "duplicate_skill",
]);

/** Server `400 invalid_body` → validation codes (zod issue messages are the codes). */
export function serverIssues(body: unknown): DraftIssue[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { issues?: unknown }).issues;
  if (!Array.isArray(raw)) return [];
  const out: DraftIssue[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const { message, path } = it as { message?: unknown; path?: unknown };
    const code = typeof message === "string" && KNOWN_CODES.has(message) ? (message as TeamValidationCode) : "generic";
    const p = Array.isArray(path) ? path : [];
    // path is ["roles", i, …] for team bodies
    const idx = p.find((x) => typeof x === "number");
    out.push({ code, roleIndex: typeof idx === "number" ? idx : null });
  }
  return out;
}

/** A fresh role of `kind`, seeded from a built-in team that has it (Yazılım Ekibi has all four). */
export function newRole(kind: RoleKind, teams: Team[], taken: Set<string>): TeamRole {
  const source =
    teams.find((t) => t.builtin && t.templateKey === "yazilim_ekibi")?.roles.find((r) => r.kind === kind) ??
    teams.flatMap((t) => (t.builtin ? t.roles : [])).find((r) => r.kind === kind);
  let id: string = kind;
  for (let n = 2; taken.has(id); n++) id = `${kind}-${n}`;
  const base: TeamRole = source
    ? { ...source, tools: [...source.tools], skills: [...source.skills] }
    : {
        id,
        kind,
        name: kind,
        instructions: "",
        model: "sonnet",
        advisorModel: null,
        tools: kind === "developer" ? ["Read", "Write", "Edit", "Bash", "Glob", "Grep"] : ["Read", "Glob", "Grep"],
        skills: [],
      };
  return { ...base, id };
}

/** Insert a role keeping the canonical CEO → Analist → Yazılımcı → QA order where possible. */
export function insertRole(roles: TeamRole[], role: TeamRole): TeamRole[] {
  const rank = ROLE_KINDS.indexOf(role.kind);
  const at = roles.findIndex((r) => ROLE_KINDS.indexOf(r.kind) > rank);
  if (at < 0) return [...roles, role];
  return [...roles.slice(0, at), role, ...roles.slice(at)];
}

export function moveRole(roles: TeamRole[], from: number, to: number): TeamRole[] {
  if (to < 0 || to >= roles.length) return roles;
  const next = [...roles];
  const [r] = next.splice(from, 1);
  next.splice(to, 0, r!);
  return next;
}

export function sameRoles(a: TeamRole[], b: TeamRole[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
