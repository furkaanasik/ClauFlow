import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Own throwaway DB: never touch the shared core/data/tasks.db (dev server, master).
vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-teams-${process.pid}-${Date.now()}`;
});
import { createProject, db, updateProject } from "../services/taskService.js";
import { BUILTIN_TEAM_IDS, defaultRole } from "../services/teamTemplates.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import teamsRouter from "./teams.js";

const SUFFIX = `teamsroute_${Date.now()}`;
let server: TestServer;
let projectId = "";

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
  server = await startTestServer([["/api/teams", teamsRouter]]);
  projectId = (
    await createProject({ name: `TeamsRoute ${SUFFIX}`, repoPath: `/tmp/${SUFFIX}`, slug: SUFFIX.replace(/_/g, "-") })
  ).id;
});

afterAll(async () => {
  await server.close();
  db.prepare(`UPDATE projects SET defaultTeamId = NULL WHERE id = ?`).run(projectId);
  db.prepare(`DELETE FROM teams WHERE projectId = ?`).run(projectId);
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
});

describe("/api/teams", () => {
  it("GET returns the four builtins", async () => {
    const { status, json } = await call("GET", "/api/teams");
    expect(status).toBe(200);
    const builtins = (json.teams as { id: string; builtin: boolean }[]).filter((t) => t.builtin);
    expect(builtins.map((t) => t.id)).toEqual([
      BUILTIN_TEAM_IDS.solo,
      BUILTIN_TEAM_IDS.yazilimEkibi,
      BUILTIN_TEAM_IDS.hataAvi,
      BUILTIN_TEAM_IDS.kesif,
    ]);
  });

  it("creates, updates and deletes a project team", async () => {
    const created = await call("POST", "/api/teams", {
      name: "Özel",
      projectId,
      fromTeamId: BUILTIN_TEAM_IDS.yazilimEkibi,
    });
    expect(created.status).toBe(201);
    const id = created.json.team.id as string;
    expect(created.json.team.roles).toHaveLength(4);

    const listed = await call("GET", `/api/teams?projectId=${projectId}`);
    expect((listed.json.teams as { id: string }[]).map((t) => t.id)).toContain(id);

    const updated = await call("PUT", `/api/teams/${id}`, {
      roles: [defaultRole("developer"), defaultRole("qa")],
    });
    expect(updated.status).toBe(200);
    expect(updated.json.team.roles.map((r: { kind: string }) => r.kind)).toEqual(["developer", "qa"]);

    const invalid = await call("PUT", `/api/teams/${id}`, { roles: [defaultRole("qa"), defaultRole("developer")] });
    expect(invalid.status).toBe(400);
    expect(invalid.json.issues.map((i: { message: string }) => i.message)).toContain("qa_before_developer");

    expect((await call("DELETE", `/api/teams/${id}`)).status).toBe(204);
    expect((await call("GET", `/api/teams/${id}`)).status).toBe(404);
  });

  it("answers 403 builtin_readonly for builtin edits and deletes", async () => {
    const put = await call("PUT", `/api/teams/${BUILTIN_TEAM_IDS.solo}`, { name: "x" });
    expect(put).toEqual({ status: 403, json: { error: "builtin_readonly" } });
    const del = await call("DELETE", `/api/teams/${BUILTIN_TEAM_IDS.kesif}`);
    expect(del).toEqual({ status: 403, json: { error: "builtin_readonly" } });
  });

  it("answers 409 team_in_use when deleting a project's default team", async () => {
    const created = await call("POST", "/api/teams", {
      name: "Varsayılan",
      projectId,
      roles: [defaultRole("developer")],
    });
    const id = created.json.team.id as string;
    await updateProject(projectId, { defaultTeamId: id });
    expect(await call("DELETE", `/api/teams/${id}`)).toEqual({ status: 409, json: { error: "team_in_use" } });
  });

  it("rejects a create without roles or a source team", async () => {
    const res = await call("POST", "/api/teams", { name: "Boş", projectId });
    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  const { rmSync } = await import("node:fs");
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
});
