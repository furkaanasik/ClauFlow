import type Database from "better-sqlite3";
import { BUILTIN_TEAM_IDS } from "./teamTemplates.js";

export const GRAPH_TO_SOLO_KEY = "ekipler_graph_to_solo";

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

export function applyEkiplerMigration(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      projectId TEXT NULL REFERENCES projects(id) ON DELETE CASCADE,
      templateKey TEXT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      roles TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS task_team_runs (
      id TEXT PRIMARY KEY,
      taskId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      teamId TEXT,
      teamSnapshot TEXT NOT NULL,
      status TEXT NOT NULL,
      qaRound INTEGER NOT NULL DEFAULT 0,
      stopReason TEXT,
      costUsd REAL NOT NULL DEFAULT 0,
      startedAt TEXT,
      finishedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS task_team_artifacts (
      id TEXT PRIMARY KEY,
      runId TEXT REFERENCES task_team_runs(id) ON DELETE CASCADE,
      taskId TEXT,
      roleId TEXT,
      roleKind TEXT,
      kind TEXT,
      round INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      verdict TEXT,
      approved INTEGER,
      commitSha TEXT,
      nodeRunId TEXT,
      costUsd REAL,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_teams_projectId ON teams(projectId);
    CREATE INDEX IF NOT EXISTS idx_task_team_runs_taskId ON task_team_runs(taskId);
    CREATE INDEX IF NOT EXISTS idx_task_team_artifacts_runId ON task_team_artifacts(runId);
    CREATE INDEX IF NOT EXISTS idx_task_team_artifacts_taskId ON task_team_artifacts(taskId);
  `);

  const projectCols = columnNames(db, "projects");
  if (!projectCols.includes("defaultTeamId")) {
    db.exec(`ALTER TABLE projects ADD COLUMN defaultTeamId TEXT`);
  }
  if (!projectCols.includes("qaMaxRounds")) {
    db.exec(`ALTER TABLE projects ADD COLUMN qaMaxRounds INTEGER NOT NULL DEFAULT 3`);
  }
  if (!projectCols.includes("specApproval")) {
    db.exec(`ALTER TABLE projects ADD COLUMN specApproval INTEGER NOT NULL DEFAULT 0`);
  }

  const taskCols = columnNames(db, "tasks");
  if (!taskCols.includes("teamId")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN teamId TEXT`);
  }

  const done = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(GRAPH_TO_SOLO_KEY);
  if (!done) {
    db.transaction(() => {
      if (taskCols.includes("executionMode")) {
        db.prepare(
          `UPDATE tasks SET teamId = ? WHERE executionMode = 'graph' AND teamId IS NULL`,
        ).run(BUILTIN_TEAM_IDS.solo);
      }
      db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)`).run(
        GRAPH_TO_SOLO_KEY,
        new Date().toISOString(),
      );
    })();
  }
}
