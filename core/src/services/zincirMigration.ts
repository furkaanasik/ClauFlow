import type Database from "better-sqlite3";

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

/**
 * Zincir (task dependency chain) migration. Additive and idempotent: the DB is
 * shared with `master`, which ignores the new table and column.
 *
 * - `task_dependencies(taskId, dependsOnId, createdAt)`: "taskId waits for
 *   dependsOnId". Both ends cascade on task delete; a self edge is rejected by
 *   the CHECK. Same-project and no-cycle rules live in `dependencyService`
 *   (SQLite CHECK cannot look at other rows).
 * - `tasks.waitUiLang`: the UI language a waiting task was started with, so an
 *   automatic start (another task's approval) can still pass it to the run.
 */
export function applyZincirMigration(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        taskId      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        dependsOnId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        createdAt   TEXT NOT NULL,
        PRIMARY KEY (taskId, dependsOnId),
        CHECK (taskId <> dependsOnId)
      );
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_dependsOn
        ON task_dependencies(dependsOnId);
    `);
    if (!columnNames(db, "tasks").includes("waitUiLang")) {
      db.exec(`ALTER TABLE tasks ADD COLUMN waitUiLang TEXT`);
    }
  })();
}
