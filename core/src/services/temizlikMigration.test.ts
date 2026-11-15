import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyTemizlikMigration, COST_BACKFILL_KEY } from "./temizlikMigration.js";

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

describe("applyTemizlikMigration · cost (F3)", () => {
  let cdir = "";
  let cdb: Database.Database;

  beforeEach(() => {
    cdir = mkdtempSync(join(tmpdir(), "temizlik-cost-"));
    cdb = new Database(join(cdir, "tasks.db"));
    cdb.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', displayId TEXT);
      CREATE TABLE task_node_runs (id TEXT PRIMARY KEY, taskId TEXT, nodeType TEXT);
      CREATE TABLE task_team_runs (id TEXT PRIMARY KEY, taskId TEXT, costUsd REAL NOT NULL DEFAULT 0);
      CREATE TABLE task_team_artifacts (id TEXT PRIMARY KEY, runId TEXT, nodeRunId TEXT, costUsd REAL, createdAt TEXT);
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO projects VALUES ('p1', 'Sandbox');
      INSERT INTO tasks (id, title, status, displayId) VALUES
        ('t13', 'slugify', 'done', 'CLF-13'),
        ('t14', 'chunk', 'review', 'CLF-14'),
        ('t1', 'untouched', 'todo', 'CLF-1');
      INSERT INTO task_team_runs VALUES
        ('r13a', 't13', 0.2767331),
        ('r13b', 't13', 0.1),
        ('r14', 't14', 0.1486596);
      INSERT INTO task_node_runs VALUES ('n1', 't13', 'ceo'), ('n2', 't13', 'developer'), ('n3', 't14', 'subagent');
      INSERT INTO task_team_artifacts VALUES
        ('a1', 'r13a', 'n1', 0.05, '2026-11-15T10:00:00Z'),
        ('a2', 'r13a', 'n2', 0.2267331, '2026-11-15T10:01:00Z');
    `);
  });

  afterEach(() => {
    cdb.close();
    rmSync(cdir, { recursive: true, force: true });
  });

  const costs = () =>
    Object.fromEntries(
      (cdb.prepare(`SELECT displayId, costUsd FROM tasks`).all() as { displayId: string; costUsd: number }[]).map(
        (r) => [r.displayId, r.costUsd],
      ),
    );

  it("adds the cost columns and backfills task and node-run costs from the team runs", () => {
    applyTemizlikMigration(cdb);
    const c = costs();
    expect(c["CLF-13"]).toBeCloseTo(0.3767331, 7);
    expect(c["CLF-14"]).toBeCloseTo(0.1486596, 7);
    expect(c["CLF-1"]).toBe(0);
    const nodes = cdb.prepare(`SELECT id, costUsd FROM task_node_runs ORDER BY id`).all();
    expect(nodes).toEqual([
      { id: "n1", costUsd: 0.05 },
      { id: "n2", costUsd: 0.2267331 },
      { id: "n3", costUsd: null },
    ]);
    expect(cdb.prepare(`SELECT planningCostUsd FROM projects`).get()).toEqual({ planningCostUsd: 0 });
    expect(cdb.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(COST_BACKFILL_KEY)).toBeTruthy();
  });

  it("backfills once: a second boot keeps live costs and the schema", () => {
    applyTemizlikMigration(cdb);
    const s1 = schema(cdb);
    cdb.prepare(`UPDATE tasks SET costUsd = costUsd + 0.5 WHERE id = 't13'`).run();
    cdb.prepare(`INSERT INTO task_team_runs VALUES ('r14b', 't14', 1)`).run();
    applyTemizlikMigration(cdb);
    expect(schema(cdb)).toBe(s1);
    const c = costs();
    expect(c["CLF-13"]).toBeCloseTo(0.8767331, 7);
    expect(c["CLF-14"]).toBeCloseTo(0.1486596, 7);
  });
});
