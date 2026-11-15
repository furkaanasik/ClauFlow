import { randomUUID } from "node:crypto";
import type {
  QaVerdict,
  RoleKind,
  Team,
  TeamArtifact,
  TeamArtifactKind,
  TeamRun,
  TeamRunStatus,
} from "../types/index.js";
import { db } from "./taskService.js";

interface RunRow {
  id: string;
  taskId: string;
  teamId: string | null;
  teamSnapshot: string;
  status: string;
  qaRound: number;
  stopReason: string | null;
  costUsd: number;
  startedAt: string | null;
  finishedAt: string | null;
}

interface ArtifactRow {
  id: string;
  runId: string;
  taskId: string;
  roleId: string | null;
  roleKind: string | null;
  kind: string;
  round: number;
  body: string;
  verdict: string | null;
  approved: number | null;
  commitSha: string | null;
  nodeRunId: string | null;
  costUsd: number | null;
  createdAt: string | null;
}

function rowToRun(row: RunRow): TeamRun {
  return {
    id: row.id,
    taskId: row.taskId,
    teamId: row.teamId,
    teamSnapshot: JSON.parse(row.teamSnapshot) as Team,
    status: row.status as TeamRunStatus,
    qaRound: row.qaRound,
    stopReason: row.stopReason,
    costUsd: row.costUsd,
    startedAt: row.startedAt ?? "",
    finishedAt: row.finishedAt,
  };
}

function rowToArtifact(row: ArtifactRow): TeamArtifact {
  return {
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    roleId: row.roleId,
    roleKind: row.roleKind as RoleKind | null,
    kind: row.kind as TeamArtifactKind,
    round: row.round,
    body: row.body,
    verdict: row.verdict as QaVerdict | null,
    approved: row.approved === null ? null : row.approved === 1,
    commitSha: row.commitSha,
    nodeRunId: row.nodeRunId,
    costUsd: row.costUsd,
    createdAt: row.createdAt ?? "",
  };
}

const stmtInsertRun = db.prepare(
  `INSERT INTO task_team_runs (id, taskId, teamId, teamSnapshot, status, qaRound, stopReason, costUsd, startedAt, finishedAt)
   VALUES (@id, @taskId, @teamId, @teamSnapshot, @status, 0, NULL, 0, @startedAt, NULL)`,
);
const stmtGetRun = db.prepare(`SELECT * FROM task_team_runs WHERE id = ?`);
const stmtListRunsByTask = db.prepare(
  `SELECT * FROM task_team_runs WHERE taskId = ? ORDER BY startedAt ASC, rowid ASC`,
);
const stmtLatestRun = db.prepare(
  `SELECT * FROM task_team_runs WHERE taskId = ? ORDER BY startedAt DESC, rowid DESC LIMIT 1`,
);
const stmtUpdateRun = db.prepare(
  `UPDATE task_team_runs SET status = @status, qaRound = @qaRound, stopReason = @stopReason,
     costUsd = @costUsd, finishedAt = @finishedAt WHERE id = @id`,
);
const stmtInsertArtifact = db.prepare(
  `INSERT INTO task_team_artifacts (id, runId, taskId, roleId, roleKind, kind, round, body, verdict, approved, commitSha, nodeRunId, costUsd, createdAt)
   VALUES (@id, @runId, @taskId, @roleId, @roleKind, @kind, @round, @body, @verdict, @approved, @commitSha, @nodeRunId, @costUsd, @createdAt)`,
);
const stmtGetArtifact = db.prepare(`SELECT * FROM task_team_artifacts WHERE id = ?`);
const stmtUpdateArtifact = db.prepare(
  `UPDATE task_team_artifacts SET body = @body, approved = @approved, commitSha = @commitSha WHERE id = @id`,
);
const stmtArtifactsByTask = db.prepare(
  `SELECT * FROM task_team_artifacts WHERE taskId = ? ORDER BY createdAt ASC, rowid ASC`,
);
const stmtArtifactsByRun = db.prepare(
  `SELECT * FROM task_team_artifacts WHERE runId = ? ORDER BY createdAt ASC, rowid ASC`,
);

export function createTeamRun(taskId: string, team: Team): TeamRun {
  const id = `teamrun_${randomUUID().slice(0, 8)}`;
  stmtInsertRun.run({
    id,
    taskId,
    teamId: team.id,
    teamSnapshot: JSON.stringify(team),
    status: "running",
    startedAt: new Date().toISOString(),
  });
  return getTeamRun(id)!;
}

export function getTeamRun(id: string): TeamRun | null {
  const row = stmtGetRun.get(id) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function getLatestTeamRun(taskId: string): TeamRun | null {
  const row = stmtLatestRun.get(taskId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function listTeamRunsByTask(taskId: string): TeamRun[] {
  return (stmtListRunsByTask.all(taskId) as RunRow[]).map(rowToRun);
}

export type TeamRunPatch = Partial<Pick<TeamRun, "status" | "qaRound" | "stopReason" | "costUsd" | "finishedAt">>;

export function updateTeamRun(id: string, patch: TeamRunPatch): TeamRun {
  const current = getTeamRun(id);
  if (!current) throw new Error(`Team run not found: ${id}`);
  const next = { ...current, ...patch };
  stmtUpdateRun.run({
    id,
    status: next.status,
    qaRound: next.qaRound,
    stopReason: next.stopReason,
    costUsd: next.costUsd,
    finishedAt: next.finishedAt,
  });
  return getTeamRun(id)!;
}

export interface InsertTeamArtifactInput {
  runId: string;
  taskId: string;
  roleId?: string | null;
  roleKind?: RoleKind | null;
  kind: TeamArtifactKind;
  round?: number;
  body: string;
  verdict?: QaVerdict | null;
  approved?: boolean | null;
  commitSha?: string | null;
  nodeRunId?: string | null;
  costUsd?: number | null;
}

export function insertTeamArtifact(input: InsertTeamArtifactInput): TeamArtifact {
  const id = `artifact_${randomUUID().slice(0, 8)}`;
  stmtInsertArtifact.run({
    id,
    runId: input.runId,
    taskId: input.taskId,
    roleId: input.roleId ?? null,
    roleKind: input.roleKind ?? null,
    kind: input.kind,
    round: input.round ?? 0,
    body: input.body,
    verdict: input.verdict ?? null,
    approved: input.approved == null ? null : input.approved ? 1 : 0,
    commitSha: input.commitSha ?? null,
    nodeRunId: input.nodeRunId ?? null,
    costUsd: input.costUsd ?? null,
    createdAt: new Date().toISOString(),
  });
  return getTeamArtifact(id)!;
}

function getTeamArtifact(id: string): TeamArtifact | null {
  const row = stmtGetArtifact.get(id) as ArtifactRow | undefined;
  return row ? rowToArtifact(row) : null;
}

export function updateTeamArtifact(
  id: string,
  patch: Partial<Pick<TeamArtifact, "body" | "approved" | "commitSha">>,
): TeamArtifact {
  const current = getTeamArtifact(id);
  if (!current) throw new Error(`Team artifact not found: ${id}`);
  const next = { ...current, ...patch };
  stmtUpdateArtifact.run({
    id,
    body: next.body,
    approved: next.approved == null ? null : next.approved ? 1 : 0,
    commitSha: next.commitSha,
  });
  return getTeamArtifact(id)!;
}

export function listTeamArtifactsByTask(taskId: string): TeamArtifact[] {
  return (stmtArtifactsByTask.all(taskId) as ArtifactRow[]).map(rowToArtifact);
}

export function listTeamArtifactsByRun(runId: string): TeamArtifact[] {
  return (stmtArtifactsByRun.all(runId) as ArtifactRow[]).map(rowToArtifact);
}
