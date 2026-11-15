import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyEkiplerMigration, GRAPH_TO_SOLO_KEY } from "./ekiplerMigration.js";

let dir = "";
let dbFile = "";

function openLegacyDb(): Database.Database {
  const db = new Database(dbFile);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repoPath TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL,
      executionMode TEXT NOT NULL DEFAULT 'simple',
      graphId TEXT
    );
  `);
  return db;
}

function cols(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ekipler-mig-"));
  dbFile = join(dir, "tasks.db");
  const db = openLegacyDb();
  db.prepare(`INSERT INTO projects (id, name, repoPath) VALUES ('p1', 'P', '/tmp/x')`).run();
  db.prepare(
    `INSERT INTO tasks (id, projectId, title, executionMode, graphId) VALUES
      ('t_graph', 'p1', 'g', 'graph', 'graph_1'),
      ('t_simple', 'p1', 's', 'simple', NULL)`,
  ).run();
  db.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("applyEkiplerMigration", () => {
  it("adds tables and columns, maps graph tasks to Solo, and is idempotent across two boots", () => {
    const first = openLegacyDb();
    applyEkiplerMigration(first);
    const tables = (
      first.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(["teams", "task_team_runs", "task_team_artifacts", "app_meta"]),
    );
    expect(cols(first, "projects")).toEqual(
      expect.arrayContaining(["defaultTeamId", "qaMaxRounds", "specApproval"]),
    );
    expect(cols(first, "tasks")).toEqual(expect.arrayContaining(["teamId", "executionMode", "graphId"]));
    expect(first.prepare(`SELECT teamId FROM tasks WHERE id='t_graph'`).get()).toEqual({ teamId: "team_solo" });
    expect(first.prepare(`SELECT teamId FROM tasks WHERE id='t_simple'`).get()).toEqual({ teamId: null });
    expect(first.prepare(`SELECT qaMaxRounds, specApproval, defaultTeamId FROM projects`).get()).toEqual({
      qaMaxRounds: 3,
      specApproval: 0,
      defaultTeamId: null,
    });
    first.prepare(`UPDATE tasks SET teamId = NULL WHERE id = 't_graph'`).run();
    first.close();

    const second = openLegacyDb();
    expect(() => applyEkiplerMigration(second)).not.toThrow();
    expect(second.prepare(`SELECT teamId FROM tasks WHERE id='t_graph'`).get()).toEqual({ teamId: null });
    expect(
      second.prepare(`SELECT COUNT(*) AS n FROM app_meta WHERE key = ?`).get(GRAPH_TO_SOLO_KEY),
    ).toEqual({ n: 1 });
    expect(cols(second, "tasks").filter((c) => c === "teamId")).toHaveLength(1);
    second.close();
  });
});
