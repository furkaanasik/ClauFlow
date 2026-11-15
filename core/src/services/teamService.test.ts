import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TeamRole } from "../types/index.js";
import { createProject, createTask, db, updateProject } from "./taskService.js";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  resolveTeamForTask,
  TeamServiceError,
  teamRolesSchema,
  updateTeam,
} from "./teamService.js";
import { BUILTIN_TEAM_IDS, defaultRole } from "./teamTemplates.js";

const SUFFIX = `teamsvc_${Date.now()}`;
let projectId = "";
let otherProjectId = "";
const createdTeams: string[] = [];

function issues(roles: unknown): string[] {
  const res = teamRolesSchema.safeParse(roles);
  return res.success ? [] : res.error.issues.map((i) => i.message);
}

function role(kind: TeamRole["kind"], patch: Partial<TeamRole> = {}): TeamRole {
  return { ...defaultRole(kind), ...patch };
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof TeamServiceError ? e.code : "other";
  }
}

beforeAll(async () => {
  projectId = (
    await createProject({ name: `TeamSvc ${SUFFIX}`, repoPath: `/tmp/${SUFFIX}`, slug: `${SUFFIX}-a`.replace(/_/g, "-") })
  ).id;
  otherProjectId = (
    await createProject({ name: `TeamSvc2 ${SUFFIX}`, repoPath: `/tmp/${SUFFIX}-b`, slug: `${SUFFIX}-b`.replace(/_/g, "-") })
  ).id;
});

afterAll(() => {
  for (const id of [projectId, otherProjectId]) {
    db.prepare(`DELETE FROM tasks WHERE projectId = ?`).run(id);
    db.prepare(`DELETE FROM teams WHERE projectId = ?`).run(id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  }
  for (const id of createdTeams) db.prepare(`DELETE FROM teams WHERE id = ?`).run(id);
});

describe("teamRolesSchema", () => {
  it("accepts every builtin team", () => {
    for (const team of listTeams().filter((t) => t.builtin)) {
      expect(issues(team.roles)).toEqual([]);
    }
  });

  it("enforces 1-4 roles", () => {
    expect(issues([])).toContain("roles_min");
    expect(
      issues([role("ceo"), role("analyst"), role("developer"), role("qa"), role("qa", { id: "qa2" })]),
    ).toContain("roles_max");
  });

  it("rejects duplicate kinds", () => {
    expect(issues([role("developer"), role("developer", { id: "dev2" })])).toContain("duplicate_kind");
  });

  it("requires a developer before QA", () => {
    expect(issues([role("analyst"), role("qa")])).toContain("qa_requires_developer");
    expect(issues([role("qa"), role("developer")])).toContain("qa_before_developer");
    expect(issues([role("developer"), role("qa")])).toEqual([]);
  });

  it("validates the advisor order and forbids a Haiku advisor", () => {
    expect(issues([role("developer", { model: "opus", advisorModel: "sonnet" })])).toContain("advisor_below_model");
    expect(issues([role("developer", { model: "haiku", advisorModel: "haiku" })])).toContain("haiku_advisor");
    expect(issues([role("developer", { model: "sonnet", advisorModel: "opus" })])).toEqual([]);
    expect(issues([role("developer", { model: "opus", advisorModel: "fable" })])).toEqual([]);
    expect(issues([role("developer", { model: "sonnet", advisorModel: null })])).toEqual([]);
  });

  it("rejects unknown tools, flag-like models and malformed skill ids", () => {
    expect(issues([role("developer", { tools: ["Read", "Rm"] })]).length).toBeGreaterThan(0);
    expect(issues([role("developer", { model: "--dangerous" })])).toContain("invalid_model");
    expect(issues([role("developer", { skills: ["no-colon"] })])).toContain("invalid_skill_id");
    expect(issues([role("developer", { skills: ["ecc:code-review", "user:foo", "project:bar"] })])).toEqual([]);
  });
});

describe("team CRUD", () => {
  it("lists builtins first, then templates, then the project's own teams", () => {
    const own = createTeam({ name: "Own", projectId, fromTeamId: BUILTIN_TEAM_IDS.hataAvi });
    const foreign = createTeam({ name: "Foreign", projectId: otherProjectId, roles: [role("developer")] });
    const tpl = createTeam({ name: `Tpl ${SUFFIX}`, projectId: null, roles: [role("developer")] });
    createdTeams.push(tpl.id);

    const ids = listTeams(projectId).map((t) => t.id);
    expect(ids.slice(0, 4)).toEqual([
      BUILTIN_TEAM_IDS.solo,
      BUILTIN_TEAM_IDS.yazilimEkibi,
      BUILTIN_TEAM_IDS.hataAvi,
      BUILTIN_TEAM_IDS.kesif,
    ]);
    expect(ids).toContain(tpl.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
    expect(ids.indexOf(tpl.id)).toBeLessThan(ids.indexOf(own.id));

    expect(own.builtin).toBe(false);
    expect(own.templateKey).toBe("hata_avi");
    expect(own.roles.map((r) => r.kind)).toEqual(["analyst", "developer", "qa"]);
  });

  it("refuses to edit or delete builtins", () => {
    expect(codeOf(() => updateTeam(BUILTIN_TEAM_IDS.solo, { name: "x" }))).toBe("builtin_readonly");
    expect(codeOf(() => deleteTeam(BUILTIN_TEAM_IDS.solo))).toBe("builtin_readonly");
  });

  it("updates a custom team and validates roles", () => {
    const team = createTeam({ name: "Editable", projectId, roles: [role("developer")] });
    const next = updateTeam(team.id, { name: "Edited", roles: [role("analyst"), role("developer")] });
    expect(next.name).toBe("Edited");
    expect(next.roles.map((r) => r.kind)).toEqual(["analyst", "developer"]);
    expect(() => updateTeam(team.id, { roles: [role("qa")] })).toThrow();
    expect(getTeam(team.id)!.roles).toHaveLength(2);
  });

  it("refuses to delete a project's default team and clears task picks on delete", async () => {
    const team = createTeam({ name: "Default", projectId, roles: [role("developer")] });
    await updateProject(projectId, { defaultTeamId: team.id });
    expect(codeOf(() => deleteTeam(team.id))).toBe("team_in_use");

    await updateProject(projectId, { defaultTeamId: null });
    const task = await createTask({ projectId, title: "picks team", teamId: team.id });
    deleteTeam(team.id);
    expect(getTeam(team.id)).toBeNull();
    const row = db.prepare(`SELECT teamId FROM tasks WHERE id = ?`).get(task.id) as { teamId: string | null };
    expect(row.teamId).toBeNull();
  });
});

describe("resolveTeamForTask", () => {
  it("prefers the task team, then the project default, then Solo", () => {
    const team = createTeam({ name: "Resolve", projectId, roles: [role("developer")] });
    expect(resolveTeamForTask({ id: "t", teamId: team.id }, { id: projectId, defaultTeamId: null }).id).toBe(team.id);
    expect(
      resolveTeamForTask({ id: "t", teamId: null }, { id: projectId, defaultTeamId: BUILTIN_TEAM_IDS.kesif }).id,
    ).toBe(BUILTIN_TEAM_IDS.kesif);
    expect(resolveTeamForTask({ id: "t", teamId: null }, { id: projectId, defaultTeamId: null }).id).toBe(
      BUILTIN_TEAM_IDS.solo,
    );
  });

  it("falls back to Solo for a missing id or another project's team", () => {
    const foreign = createTeam({ name: "Foreign2", projectId: otherProjectId, roles: [role("developer")] });
    expect(
      resolveTeamForTask({ id: "t", teamId: "team_missing" }, { id: projectId, defaultTeamId: null }).id,
    ).toBe(BUILTIN_TEAM_IDS.solo);
    expect(resolveTeamForTask({ id: "t", teamId: foreign.id }, { id: projectId, defaultTeamId: null }).id).toBe(
      BUILTIN_TEAM_IDS.solo,
    );
  });
});
