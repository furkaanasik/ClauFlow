import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, db } from "../services/taskService.js";
import { BUILTIN_TEAM_IDS, defaultRole } from "../services/teamTemplates.js";
import { createTeam } from "../services/teamService.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import projectsRouter from "./projects.js";
import tasksRouter from "./tasks.js";

const SUFFIX = `projteam_${Date.now()}`;
let server: TestServer;
let tmp = "";
const projectIds: string[] = [];

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "ekipler-proj-"));
  server = await startTestServer([
    ["/api/projects", projectsRouter],
    ["/api/tasks", tasksRouter],
  ]);
});

afterAll(async () => {
  await server.close();
  for (const id of projectIds) {
    db.prepare(`DELETE FROM tasks WHERE projectId = ?`).run(id);
    db.prepare(`UPDATE projects SET defaultTeamId = NULL WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM teams WHERE projectId = ?`).run(id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("project team settings", () => {
  it("new projects start with the Yazılım Ekibi template, 3 QA rounds and spec approval off", async () => {
    const res = await call("POST", "/api/projects", {
      name: `New ${SUFFIX}`,
      repoPath: join(tmp, "repo-new"),
      slug: `${SUFFIX}-new`.replace(/_/g, "-"),
    });
    expect(res.status).toBe(201);
    projectIds.push(res.json.project.id);
    expect(res.json.project).toMatchObject({
      defaultTeamId: BUILTIN_TEAM_IDS.yazilimEkibi,
      qaMaxRounds: 3,
      specApproval: false,
    });
  });

  it("PATCH accepts defaultTeamId, qaMaxRounds 0-20 and specApproval", async () => {
    const project = await createProject({
      name: `Patch ${SUFFIX}`,
      repoPath: join(tmp, "repo-patch"),
      slug: `${SUFFIX}-patch`.replace(/_/g, "-"),
    });
    projectIds.push(project.id);
    const other = await createProject({
      name: `Other ${SUFFIX}`,
      repoPath: join(tmp, "repo-other"),
      slug: `${SUFFIX}-other`.replace(/_/g, "-"),
    });
    projectIds.push(other.id);
    const foreign = createTeam({ name: "Foreign", projectId: other.id, roles: [defaultRole("developer")] });

    const ok = await call("PATCH", `/api/projects/${project.id}`, {
      defaultTeamId: BUILTIN_TEAM_IDS.kesif,
      qaMaxRounds: 0,
      specApproval: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.project).toMatchObject({ defaultTeamId: BUILTIN_TEAM_IDS.kesif, qaMaxRounds: 0, specApproval: true });

    const reread = await call("GET", `/api/projects/${project.id}`);
    expect(reread.json.project).toMatchObject({ defaultTeamId: BUILTIN_TEAM_IDS.kesif, qaMaxRounds: 0, specApproval: true });

    expect((await call("PATCH", `/api/projects/${project.id}`, { qaMaxRounds: 21 })).status).toBe(400);
    expect((await call("PATCH", `/api/projects/${project.id}`, { qaMaxRounds: 1.5 })).status).toBe(400);
    expect(await call("PATCH", `/api/projects/${project.id}`, { defaultTeamId: foreign.id })).toEqual({
      status: 400,
      json: { error: "invalid_team" },
    });
    const cleared = await call("PATCH", `/api/projects/${project.id}`, { defaultTeamId: null });
    expect(cleared.json.project.defaultTeamId).toBeNull();
  });
});

describe("task teamId", () => {
  it("POST/PATCH store teamId and drop executionMode/graphId", async () => {
    const project = await createProject({
      name: `Task ${SUFFIX}`,
      repoPath: join(tmp, "repo-task"),
      slug: `${SUFFIX}-task`.replace(/_/g, "-"),
    });
    projectIds.push(project.id);
    const other = await createProject({
      name: `Task other ${SUFFIX}`,
      repoPath: join(tmp, "repo-task-other"),
      slug: `${SUFFIX}-task-other`.replace(/_/g, "-"),
    });
    projectIds.push(other.id);
    const foreign = createTeam({ name: "Foreign", projectId: other.id, roles: [defaultRole("developer")] });

    const created = await call("POST", "/api/tasks", {
      projectId: project.id,
      title: "team pick",
      teamId: BUILTIN_TEAM_IDS.hataAvi,
    });
    expect(created.status).toBe(201);
    expect(created.json.task.teamId).toBe(BUILTIN_TEAM_IDS.hataAvi);
    const taskId = created.json.task.id as string;

    const patched = await call("PATCH", `/api/tasks/${taskId}`, {
      teamId: null,
      executionMode: "graph",
      graphId: "graph_x",
    });
    expect(patched.status).toBe(200);
    expect(patched.json.task.teamId).toBeNull();
    const row = db.prepare(`SELECT executionMode, graphId FROM tasks WHERE id = ?`).get(taskId);
    expect(row).toEqual({ executionMode: "simple", graphId: null });

    expect(await call("PATCH", `/api/tasks/${taskId}`, { teamId: foreign.id })).toEqual({
      status: 400,
      json: { error: "invalid_team" },
    });
    expect(
      (await call("POST", "/api/tasks", { projectId: project.id, title: "bad", teamId: "team_missing" })).status,
    ).toBe(400);
  });
});
