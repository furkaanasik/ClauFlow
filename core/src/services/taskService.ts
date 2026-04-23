import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  createEmptyAgentState,
  type AgentState,
  type Project,
  type Task,
  type TaskStatus,
  type TasksFile,
} from "../types/index.js";

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
    repoPath TEXT NOT NULL,
    defaultBranch TEXT NOT NULL DEFAULT 'main',
    remote TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    analysis TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT,
    branch TEXT,
    prUrl TEXT,
    prNumber INTEGER,
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

// ─── Row Types & Converters ───────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  repoPath: string;
  defaultBranch: string;
  remote: string | null;
  createdAt: string;
}

interface TaskRow {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  analysis: string | null;
  status: string;
  priority: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
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
    repoPath: row.repoPath,
    defaultBranch: row.defaultBranch,
    remote: row.remote,
    createdAt: row.createdAt,
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
    priority: row.priority,
    branch: row.branch,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
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
  `INSERT INTO projects (id, name, description, repoPath, defaultBranch, remote, createdAt)
   VALUES (@id, @name, @description, @repoPath, @defaultBranch, @remote, @createdAt)`,
);

const stmtListTasks = db.prepare(`SELECT * FROM tasks ORDER BY createdAt ASC`);
const stmtGetTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
const stmtInsertTask = db.prepare(
  `INSERT INTO tasks (
    id, projectId, title, description, analysis, status, priority,
    branch, prUrl, prNumber, createdAt, updatedAt,
    agentStatus, agentCurrentStep, agentLog, agentError, agentStartedAt, agentFinishedAt
  ) VALUES (
    @id, @projectId, @title, @description, @analysis, @status, @priority,
    @branch, @prUrl, @prNumber, @createdAt, @updatedAt,
    @agentStatus, @agentCurrentStep, @agentLog, @agentError, @agentStartedAt, @agentFinishedAt
  )`,
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
          repoPath: p.repoPath,
          defaultBranch: p.defaultBranch ?? "main",
          remote: p.remote ?? null,
          createdAt: p.createdAt ?? new Date().toISOString(),
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
          branch: t.branch ?? null,
          prUrl: t.prUrl ?? null,
          prNumber: t.prNumber ?? null,
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
  priority?: string;
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
  const task: Task = {
    id: `task_${randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? "",
    analysis: input.analysis ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? null,
    branch: null,
    prUrl: null,
    prNumber: null,
    createdAt: now,
    updatedAt: now,
    agent: emptyAgent,
  };

  stmtInsertTask.run({
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    analysis: task.analysis,
    status: task.status,
    priority: task.priority ?? null,
    branch: task.branch ?? null,
    prUrl: task.prUrl ?? null,
    prNumber: task.prNumber ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    agentStatus: emptyAgent.status,
    agentCurrentStep: emptyAgent.currentStep ?? null,
    agentLog: JSON.stringify(emptyAgent.log),
    agentError: emptyAgent.error ?? null,
    agentStartedAt: emptyAgent.startedAt ?? null,
    agentFinishedAt: emptyAgent.finishedAt ?? null,
  });

  return Promise.resolve(task);
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "analysis"
    | "priority"
    | "status"
    | "branch"
    | "prUrl"
    | "prNumber"
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
      branch = @branch,
      prUrl = @prUrl,
      prNumber = @prNumber,
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
    branch: next.branch ?? null,
    prUrl: next.prUrl ?? null,
    prNumber: next.prNumber ?? null,
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

export interface CreateProjectInput {
  name: string;
  description?: string;
  repoPath: string;
  defaultBranch?: string;
  remote?: string | null;
}

export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const project: Project = {
    id: `proj_${randomUUID().slice(0, 8)}`,
    name: input.name,
    description: input.description ?? "",
    repoPath: input.repoPath,
    defaultBranch: input.defaultBranch ?? "main",
    remote: input.remote ?? null,
    createdAt: new Date().toISOString(),
  };

  stmtInsertProject.run({
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    repoPath: project.repoPath,
    defaultBranch: project.defaultBranch,
    remote: project.remote ?? null,
    createdAt: project.createdAt ?? new Date().toISOString(),
  });

  return Promise.resolve(project);
}

export async function deleteTask(id: string): Promise<void> {
  const result = stmtDeleteTask.run(id);
  if (result.changes === 0) throw new Error(`Task not found: ${id}`);
  return Promise.resolve();
}
