import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyEkiplerMigration } from "./ekiplerMigration.js";
import { BUILTIN_TEAMS, BUILTIN_TEAM_IDS, upsertBuiltinTeams } from "./teamTemplates.js";

let dir = "";
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ekipler-tpl-"));
  db = new Database(join(dir, "tasks.db"));
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repoPath TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL, title TEXT NOT NULL);
  `);
  applyEkiplerMigration(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("upsertBuiltinTeams", () => {
  it("seeds the four builtin teams with fixed ids and is idempotent", () => {
    upsertBuiltinTeams(db);
    upsertBuiltinTeams(db);
    const rows = db
      .prepare(`SELECT id, builtin, projectId, roles FROM teams ORDER BY id`)
      .all() as { id: string; builtin: number; projectId: string | null; roles: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual(Object.values(BUILTIN_TEAM_IDS).sort());
    for (const row of rows) {
      expect(row.builtin).toBe(1);
      expect(row.projectId).toBeNull();
    }
    const kinds = (id: string) =>
      (JSON.parse(rows.find((r) => r.id === id)!.roles) as { kind: string }[]).map((r) => r.kind);
    expect(kinds(BUILTIN_TEAM_IDS.solo)).toEqual(["developer"]);
    expect(kinds(BUILTIN_TEAM_IDS.yazilimEkibi)).toEqual(["ceo", "analyst", "developer", "qa"]);
    expect(kinds(BUILTIN_TEAM_IDS.hataAvi)).toEqual(["analyst", "developer", "qa"]);
    expect(kinds(BUILTIN_TEAM_IDS.kesif)).toEqual(["ceo", "analyst"]);
  });

  it("overwrites edited builtin rows so prompt improvements propagate", () => {
    upsertBuiltinTeams(db);
    db.prepare(`UPDATE teams SET roles = '[]', name = 'x', builtin = 0 WHERE id = ?`).run(BUILTIN_TEAM_IDS.solo);
    upsertBuiltinTeams(db);
    const row = db.prepare(`SELECT name, roles, builtin FROM teams WHERE id = ?`).get(BUILTIN_TEAM_IDS.solo) as {
      name: string;
      roles: string;
      builtin: number;
    };
    expect(row.name).toBe("Solo");
    expect(row.builtin).toBe(1);
    expect(JSON.parse(row.roles)).toEqual(BUILTIN_TEAMS[0]!.roles);
  });

  it("uses the §7 role defaults", () => {
    const team = BUILTIN_TEAMS.find((t) => t.id === BUILTIN_TEAM_IDS.yazilimEkibi)!;
    const byKind = Object.fromEntries(team.roles.map((r) => [r.kind, r]));
    expect(byKind.ceo).toMatchObject({ model: "sonnet", advisorModel: null, tools: ["Read", "Glob", "Grep"] });
    expect(byKind.analyst).toMatchObject({ model: "opus", advisorModel: null, tools: ["Read", "Glob", "Grep", "Bash"] });
    expect(byKind.developer).toMatchObject({
      model: "sonnet",
      advisorModel: "opus",
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    });
    expect(byKind.qa).toMatchObject({ model: "sonnet", advisorModel: "opus", tools: ["Read", "Bash", "Glob", "Grep"] });
  });
});
