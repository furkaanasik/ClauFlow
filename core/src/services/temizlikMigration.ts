import type Database from "better-sqlite3";

export const COST_BACKFILL_KEY = "temizlik_cost_backfill";

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
  );
}

/**
 * Temizlik migrations. Additive and idempotent: the DB is shared with `master`,
 * so the status rewrite runs on every boot (never gated by an `app_meta` key)
 * and only rewrites rows into values both branches understand.
 *
 * - The CI column is gone: tasks parked in `ci` go back to `review`.
 * - The `nothing` status is gone: those tasks are `done`.
 * - Real cost (F3): `tasks.costUsd` (lifetime spend), `task_node_runs.costUsd`
 *   and `projects.planningCostUsd`. A one-time backfill (`app_meta`
 *   `temizlik_cost_backfill`) fills them from the team run / artifact costs
 *   the CLI already reported (`total_cost_usd`).
 */
export function applyTemizlikMigration(db: Database.Database): void {
  const migrate = db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = 'review' WHERE status = 'ci'`).run();
    db.prepare(`UPDATE tasks SET status = 'done' WHERE status = 'nothing'`).run();
  });
  migrate();
  applyCostColumns(db);
}

function applyCostColumns(db: Database.Database): void {
  if (!columnNames(db, "tasks").includes("costUsd")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN costUsd REAL NOT NULL DEFAULT 0`);
  }
  if (tableExists(db, "task_node_runs") && !columnNames(db, "task_node_runs").includes("costUsd")) {
    db.exec(`ALTER TABLE task_node_runs ADD COLUMN costUsd REAL`);
  }
  if (tableExists(db, "projects") && !columnNames(db, "projects").includes("planningCostUsd")) {
    db.exec(`ALTER TABLE projects ADD COLUMN planningCostUsd REAL NOT NULL DEFAULT 0`);
  }

  if (!tableExists(db, "app_meta")) {
    db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
  }
  const done = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(COST_BACKFILL_KEY);
  if (done) return;

  db.transaction(() => {
    if (tableExists(db, "task_team_runs")) {
      db.prepare(
        `UPDATE tasks SET costUsd = (
           SELECT COALESCE(SUM(r.costUsd), 0) FROM task_team_runs r WHERE r.taskId = tasks.id
         )
         WHERE EXISTS (SELECT 1 FROM task_team_runs r WHERE r.taskId = tasks.id)`,
      ).run();
    }
    if (tableExists(db, "task_team_artifacts") && tableExists(db, "task_node_runs")) {
      db.prepare(
        `UPDATE task_node_runs SET costUsd = (
           SELECT a.costUsd FROM task_team_artifacts a
           WHERE a.nodeRunId = task_node_runs.id AND a.costUsd IS NOT NULL
           ORDER BY a.createdAt DESC LIMIT 1
         )
         WHERE costUsd IS NULL AND EXISTS (
           SELECT 1 FROM task_team_artifacts a
           WHERE a.nodeRunId = task_node_runs.id AND a.costUsd IS NOT NULL
         )`,
      ).run();
    }
    db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)`).run(
      COST_BACKFILL_KEY,
      new Date().toISOString(),
    );
  })();
}
