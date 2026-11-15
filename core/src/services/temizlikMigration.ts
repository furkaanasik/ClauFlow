import type Database from "better-sqlite3";

/**
 * Temizlik migrations. Additive and idempotent: the DB is shared with `master`,
 * so this runs on every boot (never gated by an `app_meta` key) and only
 * rewrites rows into values both branches understand.
 *
 * - The CI column is gone: tasks parked in `ci` go back to `review`.
 * - The `nothing` status is gone: those tasks are `done`.
 */
export function applyTemizlikMigration(db: Database.Database): void {
  const migrate = db.transaction(() => {
    db.prepare(`UPDATE tasks SET status = 'review' WHERE status = 'ci'`).run();
    db.prepare(`UPDATE tasks SET status = 'done' WHERE status = 'nothing'`).run();
  });
  migrate();
}
