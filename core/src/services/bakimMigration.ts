import type Database from "better-sqlite3";

/**
 * Bakım (#8 image attachments) migration. Additive and idempotent: the DB is
 * shared with `master`, which ignores the new table.
 *
 * - `task_attachments`: one image per row, stored outside the repo under
 *   `<DATA_DIR>/attachments/<taskId>/<id>.<ext>` (`path` is absolute).
 *   Rows cascade on task delete (the route removes the files).
 * - `commentId` has no FK: comments are deleted by hand (`deleteProject`), and
 *   a NULL commentId is either a task attachment (`pending = 0`) or a comment
 *   draft uploaded before its comment exists (`pending = 1`, §3/26).
 * - `name` is the original file name (alt text, lightbox caption).
 */
export function applyBakimMigration(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id        TEXT PRIMARY KEY,
        taskId    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        commentId TEXT,
        path      TEXT NOT NULL,
        mime      TEXT NOT NULL,
        bytes     INTEGER NOT NULL,
        width     INTEGER,
        height    INTEGER,
        name      TEXT,
        pending   INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(taskId);
    `);
  })();
}
