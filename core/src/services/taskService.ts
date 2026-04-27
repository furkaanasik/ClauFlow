import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  createEmptyAgentState,
  type AgentState,
  type Project,
  type ProjectPlanningStatus,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TasksFile,
} from "../types/index.js";
import { ensureUniqueSlug, slugify } from "./slug.js";

// ─── DB Setup ─────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "tasks.db");
const LEGACY_JSON_FILE = path.join(DATA_DIR, "tasks.json");

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

export const dbPath = DB_FILE;

export const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    aiPrompt TEXT DEFAULT '',
    repoPath TEXT NOT NULL,
    defaultBranch TEXT NOT NULL DEFAULT 'main',
    remote TEXT,
    createdAt TEXT NOT NULL,
    planningStatus TEXT NOT NULL DEFAULT 'idle',
    slug TEXT,
    taskCounter INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    analysis TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    branch TEXT,
    prUrl TEXT,
    prNumber INTEGER,
    displayId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    agentStatus TEXT NOT NULL DEFAULT 'idle',
    agentCurrentStep TEXT,
    agentLog TEXT NOT NULL DEFAULT '[]',
    agentError TEXT,
    agentStartedAt TEXT,
    agentFinishedAt TEXT,
    FOREIGN KEY (projectId) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    agentLog TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL
  );
`);

// Idempotent migrations for projects table.
{
  const projectColumns = db
    .prepare(`PRAGMA table_info(projects)`)
    .all() as { name: string }[];
  const hasPlanningStatus = projectColumns.some(
    (c) => c.name === "planningStatus",
  );
  if (!hasPlanningStatus) {
    db.exec(
      `ALTER TABLE projects ADD COLUMN planningStatus TEXT NOT NULL DEFAULT 'idle'`,
    );
  }
  const hasAiPrompt = projectColumns.some((c) => c.name === "aiPrompt");
  if (!hasAiPrompt) {
    db.exec(`ALTER TABLE projects ADD COLUMN aiPrompt TEXT DEFAULT ''`);
  }
  const hasSlug = projectColumns.some((c) => c.name === "slug");
  if (!hasSlug) {
    db.exec(`ALTER TABLE projects ADD COLUMN slug TEXT`);
  }
  const hasTaskCounter = projectColumns.some((c) => c.name === "taskCounter");
  if (!hasTaskCounter) {
    db.exec(
      `ALTER TABLE projects ADD COLUMN taskCounter INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

// Idempotent migration: add tags + displayId columns to tasks if missing.
{
  const taskColumns = db
    .prepare(`PRAGMA table_info(tasks)`)
    .all() as { name: string }[];
  const hasTags = taskColumns.some((c) => c.name === "tags");
  if (!hasTags) {
    db.exec(`ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`);
  }
  const hasDisplayId = taskColumns.some((c) => c.name === "displayId");
  if (!hasDisplayId) {
    db.exec(`ALTER TABLE tasks ADD COLUMN displayId TEXT`);
  }
}

// Unique indexes (idempotent — also created above for fresh installs).
// Per-project composite enforces team spec; global partial keeps an extra
// defensive layer because slug uniqueness already implies global uniqueness.
db.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug
     ON projects(slug) WHERE slug IS NOT NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_displayId
     ON tasks(displayId) WHERE displayId IS NOT NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_displayId
     ON tasks(projectId, displayId) WHERE displayId IS NOT NULL;`,
);

// ─── Row Types & Converters ───────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  aiPrompt: string | null;
  repoPath: string;
  defaultBranch: string;
  remote: string | null;
  createdAt: string;
  planningStatus: string | null;
  slug: string | null;
  taskCounter: number | null;
}

interface TaskRow {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  analysis: string | null;
  status: string;
  priority: string | null;
  tags: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  displayId: string | null;
  createdAt: string;
  updatedAt: string;
  agentStatus: string;
  agentCurrentStep: string | null;
  agentLog: string;
  agentError: string | null;
  agentStartedAt: string | null;
  agentFinishedAt: string | null;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    aiPrompt: row.aiPrompt ?? "",
    repoPath: row.repoPath,
    defaultBranch: row.defaultBranch,
    remote: row.remote,
    createdAt: row.createdAt,
    planningStatus:
      (row.planningStatus as ProjectPlanningStatus | null) ?? "idle",
    slug: row.slug ?? null,
    taskCounter: row.taskCounter ?? 0,
  };
}

function parseAgentLog(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}

function rowToTask(row: TaskRow): Task {
  const agent: AgentState = {
    status: row.agentStatus as AgentState["status"],
    currentStep: row.agentCurrentStep ?? undefined,
    log: parseAgentLog(row.agentLog),
    error: row.agentError,
    startedAt: row.agentStartedAt,
    finishedAt: row.agentFinishedAt,
  };
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description ?? "",
    analysis: row.analysis ?? "",
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority | null,
    tags: parseTags(row.tags),
    branch: row.branch,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    displayId: row.displayId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    agent,
  };
}

// ─── Prepared Statements ──────────────────────────────────────────────────

const stmtListProjects = db.prepare(
  `SELECT * FROM projects ORDER BY createdAt ASC`,
);
const stmtGetProject = db.prepare(`SELECT * FROM projects WHERE id = ?`);
const stmtInsertProject = db.prepare(
  `INSERT INTO projects (id, name, description, aiPrompt, repoPath, defaultBranch, remote, createdAt, planningStatus, slug, taskCounter)
   VALUES (@id, @name, @description, @aiPrompt, @repoPath, @defaultBranch, @remote, @createdAt, @planningStatus, @slug, @taskCounter)`,
);

const stmtListTasks = db.prepare(`SELECT * FROM tasks ORDER BY createdAt ASC`);
const stmtGetTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
const stmtInsertTask = db.prepare(
  `INSERT INTO tasks (
    id, projectId, title, description, analysis, status, priority, tags,
    branch, prUrl, prNumber, displayId, createdAt, updatedAt,
    agentStatus, agentCurrentStep, agentLog, agentError, agentStartedAt, agentFinishedAt
  ) VALUES (
    @id, @projectId, @title, @description, @analysis, @status, @priority, @tags,
    @branch, @prUrl, @prNumber, @displayId, @createdAt, @updatedAt,
    @agentStatus, @agentCurrentStep, @agentLog, @agentError, @agentStartedAt, @agentFinishedAt
  )`,
);
const stmtBumpTaskCounter = db.prepare(
  `UPDATE projects SET taskCounter = taskCounter + 1 WHERE id = ?`,
);
const stmtGetTaskCounter = db.prepare(
  `SELECT taskCounter FROM projects WHERE id = ?`,
);
const stmtDeleteTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);
const stmtAppendLog = db.prepare(
  `UPDATE tasks SET agentLog = json_insert(agentLog, '$[#]', ?), updatedAt = ? WHERE id = ?`,
);

// ─── Legacy JSON Migration (one-shot on startup) ──────────────────────────

function migrateLegacyJsonIfPresent(): void {
  if (!existsSync(LEGACY_JSON_FILE)) return;

  // If DB already has data, do not re-import — just rename the legacy file.
  const existingProjects = db
    .prepare(`SELECT COUNT(*) as count FROM projects`)
    .get() as { count: number };
  const existingTasks = db
    .prepare(`SELECT COUNT(*) as count FROM tasks`)
    .get() as { count: number };

  if (existingProjects.count > 0 || existingTasks.count > 0) {
    try {
      const migratedPath = `${LEGACY_JSON_FILE}.migrated`;
      if (!existsSync(migratedPath)) {
        renameSync(LEGACY_JSON_FILE, migratedPath);
        console.log(
          `[taskService] DB already populated; renamed legacy ${LEGACY_JSON_FILE} → ${migratedPath}`,
        );
      }
    } catch (err) {
      console.error("[taskService] legacy rename failed:", err);
    }
    return;
  }

  let file: TasksFile;
  try {
    const raw = readFileSync(LEGACY_JSON_FILE, "utf8");
    file = JSON.parse(raw) as TasksFile;

    const importAll = db.transaction(() => {
      for (const p of file.projects ?? []) {
        stmtInsertProject.run({
          id: p.id,
          name: p.name,
          description: p.description ?? "",
          aiPrompt: p.aiPrompt ?? "",
          repoPath: p.repoPath,
          defaultBranch: p.defaultBranch ?? "main",
          remote: p.remote ?? null,
          createdAt: p.createdAt ?? new Date().toISOString(),
          planningStatus: p.planningStatus ?? "idle",
          slug: p.slug ?? null,
          taskCounter: p.taskCounter ?? 0,
        });
      }
      for (const t of file.tasks ?? []) {
        const agent = t.agent ?? createEmptyAgentState();
        stmtInsertTask.run({
          id: t.id,
          projectId: t.projectId,
          title: t.title,
          description: t.description ?? "",
          analysis: t.analysis ?? "",
          status: t.status ?? "todo",
          priority: t.priority ?? null,
          tags: JSON.stringify(t.tags ?? []),
          branch: t.branch ?? null,
          prUrl: t.prUrl ?? null,
          prNumber: t.prNumber ?? null,
          displayId: t.displayId ?? null,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          agentStatus: agent.status,
          agentCurrentStep: agent.currentStep ?? null,
          agentLog: JSON.stringify(agent.log ?? []),
          agentError: agent.error ?? null,
          agentStartedAt: agent.startedAt ?? null,
          agentFinishedAt: agent.finishedAt ?? null,
        });
      }
    });
    importAll();

    const migratedPath = `${LEGACY_JSON_FILE}.migrated`;
    renameSync(LEGACY_JSON_FILE, migratedPath);
    console.log(
      `[taskService] migrated ${file.projects?.length ?? 0} projects, ${
        file.tasks?.length ?? 0
      } tasks from tasks.json → SQLite; renamed → ${migratedPath}`,
    );
  } catch (err) {
    console.error("[taskService] legacy migration failed:", err);
  }
}

migrateLegacyJsonIfPresent();

// ─── Backfill: slug + displayId for pre-existing rows ─────────────────────
// Idempotent — only fills in NULLs. Safe to re-run on every boot.
function backfillSlugsAndDisplayIds(): void {
  const projectRows = db
    .prepare(
      `SELECT id, name, slug, taskCounter FROM projects ORDER BY createdAt ASC`,
    )
    .all() as {
    id: string;
    name: string;
    slug: string | null;
    taskCounter: number | null;
  }[];

  if (projectRows.length === 0) return;

  const tx = db.transaction(() => {
    const takenSlugs = new Set<string>(
      projectRows
        .map((p) => p.slug)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    );

    for (const p of projectRows) {
      let slug = p.slug ?? null;
      if (!slug) {
        slug = ensureUniqueSlug(p.name, takenSlugs);
        takenSlugs.add(slug);
        db.prepare(`UPDATE projects SET slug = ? WHERE id = ?`).run(
          slug,
          p.id,
        );
      }

      const tasks = db
        .prepare(
          `SELECT id, displayId FROM tasks WHERE projectId = ? ORDER BY createdAt ASC, id ASC`,
        )
        .all(p.id) as { id: string; displayId: string | null }[];

      const slugUpper = slug.toUpperCase();
      let maxNumber = 0;
      for (const t of tasks) {
        if (t.displayId) {
          const m = t.displayId.match(/-(\d+)$/);
          if (m) {
            const n = Number.parseInt(m[1] ?? "0", 10);
            if (Number.isFinite(n) && n > maxNumber) maxNumber = n;
          }
        }
      }

      let next = maxNumber;
      const updateStmt = db.prepare(
        `UPDATE tasks SET displayId = ? WHERE id = ?`,
      );
      for (const t of tasks) {
        if (!t.displayId) {
          next += 1;
          updateStmt.run(`${slugUpper}-${next}`, t.id);
        }
      }

      const newCounter = Math.max(p.taskCounter ?? 0, next);
      if (newCounter !== (p.taskCounter ?? 0)) {
        db.prepare(`UPDATE projects SET taskCounter = ? WHERE id = ?`).run(
          newCounter,
          p.id,
        );
      }
    }
  });
  tx();
}

backfillSlugsAndDisplayIds();

// ─── Public API ───────────────────────────────────────────────────────────

const stmtListTasksByProject = db.prepare(
  `SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt ASC`,
);

export async function listTasks(projectId?: string): Promise<Task[]> {
  if (projectId) {
    const rows = stmtListTasksByProject.all(projectId) as TaskRow[];
    return Promise.resolve(rows.map(rowToTask));
  }
  const rows = stmtListTasks.all() as TaskRow[];
  return Promise.resolve(rows.map(rowToTask));
}

export async function getTask(id: string): Promise<Task | null> {
  const row = stmtGetTask.get(id) as TaskRow | undefined;
  return Promise.resolve(row ? rowToTask(row) : null);
}

export async function listProjects(): Promise<Project[]> {
  const rows = stmtListProjects.all() as ProjectRow[];
  return Promise.resolve(rows.map(rowToProject));
}

export async function getProject(id: string): Promise<Project | null> {
  const row = stmtGetProject.get(id) as ProjectRow | undefined;
  return Promise.resolve(row ? rowToProject(row) : null);
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  analysis?: string;
  priority?: TaskPriority | null;
  tags?: string[];
  status?: TaskStatus;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const project = stmtGetProject.get(input.projectId) as
    | ProjectRow
    | undefined;
  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`);
  }
  const now = new Date().toISOString();
  const emptyAgent = createEmptyAgentState();
  const taskId = `task_${randomUUID().slice(0, 8)}`;

  // Atomic counter increment + insert in a single transaction. Two prepared
  // statements (UPDATE then SELECT) instead of UPDATE...RETURNING for broader
  // SQLite version compatibility.
  const insertWithCounter = db.transaction(() => {
    let displayId: string | null = null;
    if (project.slug) {
      stmtBumpTaskCounter.run(project.id);
      const row = stmtGetTaskCounter.get(project.id) as
        | { taskCounter: number }
        | undefined;
      const counter = row?.taskCounter ?? 0;
      displayId = `${project.slug.toUpperCase()}-${counter}`;
    }
    stmtInsertTask.run({
      id: taskId,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? "",
      analysis: input.analysis ?? "",
      status: input.status ?? "todo",
      priority: input.priority ?? null,
      tags: JSON.stringify(input.tags ?? []),
      branch: null,
      prUrl: null,
      prNumber: null,
      displayId,
      createdAt: now,
      updatedAt: now,
      agentStatus: emptyAgent.status,
      agentCurrentStep: emptyAgent.currentStep ?? null,
      agentLog: JSON.stringify(emptyAgent.log),
      agentError: emptyAgent.error ?? null,
      agentStartedAt: emptyAgent.startedAt ?? null,
      agentFinishedAt: emptyAgent.finishedAt ?? null,
    });
    return displayId;
  });

  const displayId = insertWithCounter();

  const task: Task = {
    id: taskId,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? "",
    analysis: input.analysis ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? null,
    tags: input.tags ?? [],
    branch: null,
    prUrl: null,
    prNumber: null,
    displayId,
    createdAt: now,
    updatedAt: now,
    agent: emptyAgent,
  };

  return Promise.resolve(task);
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "analysis"
    | "priority"
    | "tags"
    | "status"
    | "branch"
    | "prUrl"
    | "prNumber"
    | "displayId"
  >
> & { agent?: Partial<AgentState> };

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  const row = stmtGetTask.get(id) as TaskRow | undefined;
  if (!row) throw new Error(`Task not found: ${id}`);
  const current = rowToTask(row);

  const next: Task = {
    ...current,
    ...patch,
    agent: patch.agent ? { ...current.agent, ...patch.agent } : current.agent,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE tasks SET
      title = @title,
      description = @description,
      analysis = @analysis,
      status = @status,
      priority = @priority,
      tags = @tags,
      branch = @branch,
      prUrl = @prUrl,
      prNumber = @prNumber,
      displayId = @displayId,
      updatedAt = @updatedAt,
      agentStatus = @agentStatus,
      agentCurrentStep = @agentCurrentStep,
      agentLog = @agentLog,
      agentError = @agentError,
      agentStartedAt = @agentStartedAt,
      agentFinishedAt = @agentFinishedAt
     WHERE id = @id`,
  ).run({
    id: next.id,
    title: next.title,
    description: next.description,
    analysis: next.analysis,
    status: next.status,
    priority: next.priority ?? null,
    tags: JSON.stringify(next.tags ?? []),
    branch: next.branch ?? null,
    prUrl: next.prUrl ?? null,
    prNumber: next.prNumber ?? null,
    displayId: next.displayId ?? null,
    updatedAt: next.updatedAt,
    agentStatus: next.agent.status,
    agentCurrentStep: next.agent.currentStep ?? null,
    agentLog: JSON.stringify(next.agent.log ?? []),
    agentError: next.agent.error ?? null,
    agentStartedAt: next.agent.startedAt ?? null,
    agentFinishedAt: next.agent.finishedAt ?? null,
  });

  return Promise.resolve(next);
}

export async function appendAgentLog(
  id: string,
  line: string,
): Promise<void> {
  stmtAppendLog.run(line, new Date().toISOString(), id);
  return Promise.resolve();
}

export async function recoverOrphanedTasks(): Promise<number> {
  const now = new Date().toISOString();
  // Any task left in "doing" after a server restart has no live executor
  // (RUNNING map is in-memory). Roll all of them back to todo+error.
  const result = db
    .prepare(
      `UPDATE tasks
         SET status = 'todo',
             agentStatus = 'error',
             agentError = 'Sunucu yeniden başlatıldı; task otomatik kurtarıldı',
             agentFinishedAt = @now,
             updatedAt = @now
       WHERE status = 'doing'`,
    )
    .run({ now });
  return result.changes;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  aiPrompt?: string;
  repoPath: string;
  defaultBranch?: string;
  remote?: string | null;
  slug?: string | null;
}

export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const existingSlugs = (
    db.prepare(`SELECT slug FROM projects WHERE slug IS NOT NULL`).all() as {
      slug: string | null;
    }[]
  )
    .map((r) => r.slug)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  const requestedSlug = input.slug ? slugify(input.slug) : null;
  const baseForSlug = requestedSlug || input.name;
  const slug = ensureUniqueSlug(baseForSlug, existingSlugs);

  const project: Project = {
    id: `proj_${randomUUID().slice(0, 8)}`,
    name: input.name,
    description: input.description ?? "",
    aiPrompt: input.aiPrompt ?? "",
    repoPath: input.repoPath,
    defaultBranch: input.defaultBranch ?? "main",
    remote: input.remote ?? null,
    createdAt: new Date().toISOString(),
    planningStatus: "idle",
    slug,
    taskCounter: 0,
  };

  stmtInsertProject.run({
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    aiPrompt: project.aiPrompt ?? "",
    repoPath: project.repoPath,
    defaultBranch: project.defaultBranch,
    remote: project.remote ?? null,
    createdAt: project.createdAt ?? new Date().toISOString(),
    planningStatus: project.planningStatus ?? "idle",
    slug: project.slug ?? null,
    taskCounter: project.taskCounter ?? 0,
  });

  return Promise.resolve(project);
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | "name"
    | "description"
    | "aiPrompt"
    | "repoPath"
    | "defaultBranch"
    | "remote"
    | "planningStatus"
    | "slug"
  >
>;

export async function updateProject(
  id: string,
  patch: ProjectPatch,
): Promise<Project> {
  const row = stmtGetProject.get(id) as ProjectRow | undefined;
  if (!row) throw new Error(`Project not found: ${id}`);
  const current = rowToProject(row);

  let nextSlug = current.slug ?? null;
  if (patch.slug !== undefined && patch.slug !== current.slug) {
    if (patch.slug === null || patch.slug === "") {
      nextSlug = null;
    } else {
      const normalized = slugify(patch.slug);
      if (!normalized) {
        throw new Error(`Invalid slug: ${patch.slug}`);
      }
      const otherSlugs = (
        db
          .prepare(
            `SELECT slug FROM projects WHERE slug IS NOT NULL AND id <> ?`,
          )
          .all(id) as { slug: string | null }[]
      )
        .map((r) => r.slug)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      if (otherSlugs.includes(normalized)) {
        throw new Error(`Slug already in use: ${normalized}`);
      }
      nextSlug = normalized;
    }
  }

  const next: Project = {
    ...current,
    ...patch,
    slug: nextSlug,
  };

  db.prepare(
    `UPDATE projects SET
      name = @name,
      description = @description,
      aiPrompt = @aiPrompt,
      repoPath = @repoPath,
      defaultBranch = @defaultBranch,
      remote = @remote,
      planningStatus = @planningStatus,
      slug = @slug
     WHERE id = @id`,
  ).run({
    id,
    name: next.name,
    description: next.description ?? "",
    aiPrompt: next.aiPrompt ?? "",
    repoPath: next.repoPath,
    defaultBranch: next.defaultBranch,
    remote: next.remote ?? null,
    planningStatus: next.planningStatus ?? "idle",
    slug: next.slug ?? null,
  });

  return Promise.resolve(next);
}

export async function deleteProject(id: string): Promise<void> {
  const row = stmtGetProject.get(id) as ProjectRow | undefined;
  if (!row) throw new Error(`Project not found: ${id}`);

  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM comments WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)`,
    ).run(id);
    db.prepare(`DELETE FROM tasks WHERE projectId = ?`).run(id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  });
  tx();
}

export async function projectHasActiveTasks(id: string): Promise<boolean> {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM tasks
       WHERE projectId = ? AND status IN ('doing', 'review')`,
    )
    .get(id) as { count: number };
  return row.count > 0;
}

export async function deleteTask(id: string): Promise<void> {
  const result = stmtDeleteTask.run(id);
  if (result.changes === 0) throw new Error(`Task not found: ${id}`);
  return Promise.resolve();
}
