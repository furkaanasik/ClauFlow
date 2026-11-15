import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Project, RoleKind, Task, Team, TeamRole } from "../types/index.js";
import { isValidAdvisor, modelRank } from "./claudeCapabilities.js";
import { db } from "./taskService.js";
import { BUILTIN_TEAMS, BUILTIN_TEAM_IDS, ROLE_TOOLS } from "./teamTemplates.js";

type TeamErrorCode =
  | "not_found"
  | "builtin_readonly"
  | "team_in_use"
  | "invalid_team"
  | "project_not_found";

export class TeamServiceError extends Error {
  constructor(
    readonly code: TeamErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TeamServiceError";
  }
}

const modelSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/, "invalid_model");

const roleKindSchema = z.enum(["ceo", "analyst", "developer", "qa"]);

const teamRoleSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/, "invalid_role_id"),
  kind: roleKindSchema,
  name: z.string().trim().min(1).max(80),
  instructions: z.string().max(20_000),
  model: modelSchema,
  advisorModel: modelSchema.nullable(),
  tools: z.array(z.enum(ROLE_TOOLS)).min(1).max(ROLE_TOOLS.length),
  skills: z
    .array(z.string().max(200).regex(/^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/, "invalid_skill_id"))
    .max(30),
});

export const teamRolesSchema = z
  .array(teamRoleSchema)
  .min(1, "roles_min")
  .max(4, "roles_max")
  .superRefine((roles, ctx) => {
    const seenKinds = new Set<RoleKind>();
    const seenIds = new Set<string>();
    roles.forEach((role, i) => {
      if (seenKinds.has(role.kind)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "kind"], message: "duplicate_kind" });
      }
      seenKinds.add(role.kind);
      if (seenIds.has(role.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "id"], message: "duplicate_role_id" });
      }
      seenIds.add(role.id);
      if (new Set(role.tools).size !== role.tools.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "tools"], message: "duplicate_tool" });
      }
      if (new Set(role.skills).size !== role.skills.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "skills"], message: "duplicate_skill" });
      }
      if (role.advisorModel !== null) {
        if (modelRank(role.advisorModel) === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "advisorModel"],
            message: "haiku_advisor",
          });
        } else if (!isValidAdvisor(role.model, role.advisorModel)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "advisorModel"],
            message: "advisor_below_model",
          });
        }
      }
    });
    const qaIndex = roles.findIndex((r) => r.kind === "qa");
    const devIndex = roles.findIndex((r) => r.kind === "developer");
    if (qaIndex >= 0) {
      if (devIndex < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [qaIndex, "kind"], message: "qa_requires_developer" });
      } else if (devIndex > qaIndex) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [qaIndex, "kind"], message: "qa_before_developer" });
      }
    }
  });

export const teamNameSchema = z.string().trim().min(1).max(80);
export const teamDescriptionSchema = z.string().max(500);

interface TeamRow {
  id: string;
  projectId: string | null;
  templateKey: string | null;
  name: string;
  description: string | null;
  roles: string;
  builtin: number;
  createdAt: string | null;
  updatedAt: string | null;
}

function parseRoles(raw: string): TeamRole[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TeamRole[]) : [];
  } catch {
    return [];
  }
}

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    projectId: row.projectId,
    templateKey: row.templateKey,
    name: row.name,
    description: row.description ?? "",
    roles: parseRoles(row.roles),
    builtin: row.builtin === 1,
    createdAt: row.createdAt ?? "",
    updatedAt: row.updatedAt ?? "",
  };
}

const stmtGetTeam = db.prepare(`SELECT * FROM teams WHERE id = ?`);
const stmtListGlobalTeams = db.prepare(
  `SELECT * FROM teams WHERE projectId IS NULL ORDER BY createdAt ASC, id ASC`,
);
const stmtListProjectTeams = db.prepare(
  `SELECT * FROM teams WHERE projectId = ? ORDER BY createdAt ASC, id ASC`,
);
const stmtInsertTeam = db.prepare(
  `INSERT INTO teams (id, projectId, templateKey, name, description, roles, builtin, createdAt, updatedAt)
   VALUES (@id, @projectId, @templateKey, @name, @description, @roles, 0, @now, @now)`,
);
const stmtUpdateTeam = db.prepare(
  `UPDATE teams SET name = @name, description = @description, roles = @roles, updatedAt = @now WHERE id = @id`,
);
const stmtDeleteTeam = db.prepare(`DELETE FROM teams WHERE id = ?`);
const stmtCountProjectsUsingTeam = db.prepare(
  `SELECT COUNT(*) AS n FROM projects WHERE defaultTeamId = ?`,
);
const stmtClearTaskTeam = db.prepare(`UPDATE tasks SET teamId = NULL WHERE teamId = ?`);
const stmtProjectExists = db.prepare(`SELECT id FROM projects WHERE id = ?`);

const BUILTIN_ORDER = new Map(BUILTIN_TEAMS.map((t, i) => [t.id, i]));

export function getTeam(id: string): Team | null {
  const row = stmtGetTeam.get(id) as TeamRow | undefined;
  return row ? rowToTeam(row) : null;
}

export function listTeams(projectId?: string | null): Team[] {
  const globals = (stmtListGlobalTeams.all() as TeamRow[]).map(rowToTeam);
  const builtins = globals
    .filter((t) => t.builtin)
    .sort((a, b) => (BUILTIN_ORDER.get(a.id) ?? 99) - (BUILTIN_ORDER.get(b.id) ?? 99));
  const templates = globals.filter((t) => !t.builtin);
  const projectTeams = projectId
    ? (stmtListProjectTeams.all(projectId) as TeamRow[]).map(rowToTeam)
    : [];
  return [...builtins, ...templates, ...projectTeams];
}

function isTeamUsableByProject(team: Team, projectId: string): boolean {
  return team.projectId === null || team.projectId === projectId;
}

export function assertTeamUsableByProject(teamId: string, projectId: string): Team {
  const team = getTeam(teamId);
  if (!team || !isTeamUsableByProject(team, projectId)) {
    throw new TeamServiceError("invalid_team", `Team not usable by project: ${teamId}`);
  }
  return team;
}

interface CreateTeamInput {
  name: string;
  description?: string;
  projectId: string | null;
  roles?: TeamRole[];
  fromTeamId?: string;
}

export function createTeam(input: CreateTeamInput): Team {
  if (input.projectId !== null && !stmtProjectExists.get(input.projectId)) {
    throw new TeamServiceError("project_not_found");
  }
  const source = input.fromTeamId ? getTeam(input.fromTeamId) : null;
  if (input.fromTeamId && !source) {
    throw new TeamServiceError("not_found", `Source team not found: ${input.fromTeamId}`);
  }
  const roles = teamRolesSchema.parse(input.roles ?? source?.roles ?? []);
  const id = `team_${randomUUID().slice(0, 8)}`;
  stmtInsertTeam.run({
    id,
    projectId: input.projectId,
    templateKey: source?.templateKey ?? null,
    name: teamNameSchema.parse(input.name),
    description: teamDescriptionSchema.parse(input.description ?? source?.description ?? ""),
    roles: JSON.stringify(roles),
    now: new Date().toISOString(),
  });
  return getTeam(id)!;
}

interface UpdateTeamPatch {
  name?: string;
  description?: string;
  roles?: TeamRole[];
}

export function updateTeam(id: string, patch: UpdateTeamPatch): Team {
  const current = getTeam(id);
  if (!current) throw new TeamServiceError("not_found");
  if (current.builtin) throw new TeamServiceError("builtin_readonly");
  stmtUpdateTeam.run({
    id,
    name: patch.name !== undefined ? teamNameSchema.parse(patch.name) : current.name,
    description:
      patch.description !== undefined
        ? teamDescriptionSchema.parse(patch.description)
        : current.description,
    roles: JSON.stringify(patch.roles !== undefined ? teamRolesSchema.parse(patch.roles) : current.roles),
    now: new Date().toISOString(),
  });
  return getTeam(id)!;
}

export function deleteTeam(id: string): void {
  const current = getTeam(id);
  if (!current) throw new TeamServiceError("not_found");
  if (current.builtin) throw new TeamServiceError("builtin_readonly");
  const { n } = stmtCountProjectsUsingTeam.get(id) as { n: number };
  if (n > 0) throw new TeamServiceError("team_in_use");
  db.transaction(() => {
    stmtClearTaskTeam.run(id);
    stmtDeleteTeam.run(id);
  })();
}

function getSoloTeam(): Team {
  const solo = getTeam(BUILTIN_TEAM_IDS.solo);
  if (!solo) throw new Error("Builtin Solo team missing");
  return solo;
}

export function resolveTeamForTask(
  task: Pick<Task, "id" | "teamId">,
  project: Pick<Project, "id" | "defaultTeamId">,
): Team {
  const wanted = task.teamId ?? project.defaultTeamId ?? BUILTIN_TEAM_IDS.solo;
  const team = getTeam(wanted);
  if (team && isTeamUsableByProject(team, project.id)) return team;
  console.warn(
    `[teams] team ${wanted} for task ${task.id} not found or not usable by project ${project.id}; falling back to Solo`,
  );
  return getSoloTeam();
}
