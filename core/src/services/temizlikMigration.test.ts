import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyTemizlikMigration } from "./temizlikMigration.js";

let dir = "";
let db: Database.Database;

function schema(d: Database.Database): string {
  return (d.prepare(`SELECT sql FROM sqlite_master ORDER BY name`).all() as { sql: string | null }[])
    .map((r) => r.sql ?? "")
    .join("\n");
}

function statuses(d: Database.Database): Record<string, string> {
  const rows = d.prepare(`SELECT id, status FROM tasks ORDER BY id`).all() as { id: string; status: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "temizlik-mig-"));
  db = new Database(join(dir, "tasks.db"));
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo')`);
  db.prepare(
    `INSERT INTO tasks (id, title, status) VALUES
      ('t_ci', 'a', 'ci'),
      ('t_nothing', 'b', 'nothing'),
      ('t_todo', 'c', 'todo'),
      ('t_doing', 'd', 'doing'),
      ('t_review', 'e', 'review'),
      ('t_done', 'f', 'done')`,
  ).run();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("applyTemizlikMigration", () => {
  it("moves ci → review and nothing → done, leaves the rest", () => {
    applyTemizlikMigration(db);
    expect(statuses(db)).toEqual({
      t_ci: "review",
      t_nothing: "done",
      t_todo: "todo",
      t_doing: "doing",
      t_review: "review",
      t_done: "done",
    });
  });

  it("is idempotent: a second call changes neither schema nor data", () => {
    applyTemizlikMigration(db);
    const s1 = schema(db);
    const d1 = statuses(db);
    expect(() => applyTemizlikMigration(db)).not.toThrow();
    expect(schema(db)).toBe(s1);
    expect(statuses(db)).toEqual(d1);
  });

  it("re-converts rows that an older build writes again (runs every boot)", () => {
    applyTemizlikMigration(db);
    db.prepare(`UPDATE tasks SET status = 'ci' WHERE id = 't_todo'`).run();
    applyTemizlikMigration(db);
    expect(statuses(db).t_todo).toBe("review");
  });
});
