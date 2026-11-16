import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyZincirMigration } from "./zincirMigration.js";

let dir = "";
let db: Database.Database;

function schema(d: Database.Database): string {
  return (d.prepare(`SELECT sql FROM sqlite_master ORDER BY name`).all() as { sql: string | null }[])
    .map((r) => r.sql ?? "")
    .join("\n");
}

function rows(d: Database.Database): unknown[] {
  return d.prepare(`SELECT id, title, status FROM tasks ORDER BY id`).all();
}

function edges(d: Database.Database): Array<[string, string]> {
  return (
    d.prepare(`SELECT taskId, dependsOnId FROM task_dependencies ORDER BY taskId, dependsOnId`).all() as {
      taskId: string;
      dependsOnId: string;
    }[]
  ).map((r) => [r.taskId, r.dependsOnId]);
}

function addEdge(d: Database.Database, taskId: string, dependsOnId: string): void {
  d.prepare(`INSERT INTO task_dependencies (taskId, dependsOnId, createdAt) VALUES (?, ?, ?)`).run(
    taskId,
    dependsOnId,
    new Date().toISOString(),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zincir-mig-"));
  db = new Database(join(dir, "tasks.db"));
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo')`);
  db.prepare(
    `INSERT INTO tasks (id, title, status) VALUES ('a', 'A', 'done'), ('b', 'B', 'todo'), ('c', 'C', 'doing')`,
  ).run();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("applyZincirMigration", () => {
  it("creates the table, the index and waitUiLang; existing rows are untouched", () => {
    const before = rows(db);
    applyZincirMigration(db);
    const names = (db.prepare(`SELECT name FROM sqlite_master`).all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("task_dependencies");
    expect(names).toContain("idx_task_dependencies_dependsOn");
    const cols = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === "waitUiLang")).toHaveLength(1);
    expect(rows(db)).toEqual(before);
    expect((db.prepare(`SELECT waitUiLang FROM tasks`).all() as { waitUiLang: unknown }[]).every((r) => r.waitUiLang === null)).toBe(true);
  });

  it("is idempotent: a second call changes neither schema nor data", () => {
    applyZincirMigration(db);
    addEdge(db, "b", "a");
    const s1 = schema(db);
    const r1 = rows(db);
    expect(() => applyZincirMigration(db)).not.toThrow();
    expect(schema(db)).toBe(s1);
    expect(rows(db)).toEqual(r1);
    expect(edges(db)).toEqual([["b", "a"]]);
    const cols = (db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === "waitUiLang")).toHaveLength(1);
  });

  it("deleting a task removes edges in both directions (foreign_keys = ON)", () => {
    applyZincirMigration(db);
    addEdge(db, "b", "a");
    addEdge(db, "c", "b");
    addEdge(db, "c", "a");
    db.prepare(`DELETE FROM tasks WHERE id = 'b'`).run();
    expect(edges(db)).toEqual([["c", "a"]]);
  });

  it("the CHECK rejects a self edge", () => {
    applyZincirMigration(db);
    expect(() => addEdge(db, "a", "a")).toThrow(/CHECK/);
    expect(edges(db)).toEqual([]);
  });

  it("rejects an edge to an unknown task and a duplicate edge", () => {
    applyZincirMigration(db);
    expect(() => addEdge(db, "a", "nope")).toThrow(/FOREIGN KEY/);
    addEdge(db, "b", "a");
    expect(() => addEdge(db, "b", "a")).toThrow(/UNIQUE|PRIMARY/);
  });
});
