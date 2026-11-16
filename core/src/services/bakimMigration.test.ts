import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyBakimMigration } from "./bakimMigration.js";

let dir = "";
let db: Database.Database;

const schema = (d: Database.Database): string =>
  (d.prepare(`SELECT sql FROM sqlite_master ORDER BY name`).all() as { sql: string | null }[])
    .map((r) => r.sql ?? "")
    .join("\n");
const rows = (d: Database.Database): unknown[] => d.prepare(`SELECT id, title, status FROM tasks ORDER BY id`).all();
const atts = (d: Database.Database): string[] =>
  (d.prepare(`SELECT id FROM task_attachments ORDER BY id`).all() as { id: string }[]).map((r) => r.id);

function addAtt(d: Database.Database, id: string, taskId: string, extra: Record<string, unknown> = {}): void {
  d.prepare(
    `INSERT INTO task_attachments (id, taskId, commentId, path, mime, bytes, width, height, name, createdAt)
     VALUES (@id, @taskId, @commentId, @path, 'image/png', 10, 1, 1, 'a.png', @createdAt)`,
  ).run({ id, taskId, commentId: null, path: `/data/attachments/${taskId}/${id}.png`, createdAt: new Date().toISOString(), ...extra });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bakim-mig-"));
  db = new Database(join(dir, "tasks.db"));
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo')`);
  db.prepare(`INSERT INTO tasks (id, title, status) VALUES ('a', 'A', 'done'), ('b', 'B', 'todo')`).run();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("applyBakimMigration", () => {
  it("creates task_attachments with the planned columns and index; existing rows untouched", () => {
    const before = rows(db);
    applyBakimMigration(db);
    const cols = db.prepare(`PRAGMA table_info(task_attachments)`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    expect(cols.map((c) => c.name)).toEqual([
      "id",
      "taskId",
      "commentId",
      "path",
      "mime",
      "bytes",
      "width",
      "height",
      "name",
      "pending",
      "createdAt",
    ]);
    const by = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(by.id!.pk).toBe(1);
    expect(by.taskId!.notnull).toBe(1);
    expect(by.commentId!.notnull).toBe(0);
    expect(by.pending!.dflt_value).toBe("0");
    expect(by.pending!.notnull).toBe(1);
    const names = (db.prepare(`SELECT name FROM sqlite_master`).all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("idx_task_attachments_task");
    expect(rows(db)).toEqual(before);
  });

  it("is idempotent: a second call changes neither schema nor data", () => {
    applyBakimMigration(db);
    addAtt(db, "att_1", "a");
    const s1 = schema(db);
    expect(() => applyBakimMigration(db)).not.toThrow();
    expect(schema(db)).toBe(s1);
    expect(atts(db)).toEqual(["att_1"]);
  });

  it("pending defaults to 0; a task delete cascades to its attachments only", () => {
    applyBakimMigration(db);
    addAtt(db, "att_1", "a");
    addAtt(db, "att_2", "a", { commentId: "comment_x" });
    addAtt(db, "att_3", "b");
    expect((db.prepare(`SELECT pending FROM task_attachments WHERE id = 'att_1'`).get() as { pending: number }).pending).toBe(0);
    db.prepare(`DELETE FROM tasks WHERE id = 'a'`).run();
    expect(atts(db)).toEqual(["att_3"]);
  });

  it("rejects an attachment for a task that does not exist (foreign_keys = ON)", () => {
    applyBakimMigration(db);
    expect(() => addAtt(db, "att_9", "nope")).toThrow(/FOREIGN KEY/);
  });
});
