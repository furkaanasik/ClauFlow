import { randomUUID } from "node:crypto";
import { db } from "./taskService.js";
import type { Comment, CommentStatus } from "../types/index.js";

export type { Comment, CommentStatus } from "../types/index.js";

// ─── Row Types & Converters ───────────────────────────────────────────────

interface CommentRow {
  id: string;
  taskId: string;
  body: string;
  status: string;
  agentLog: string;
  createdAt: string;
}

function parseAgentLog(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.taskId,
    body: row.body,
    status: row.status as CommentStatus,
    agentLog: parseAgentLog(row.agentLog),
    createdAt: row.createdAt,
  };
}

// ─── Prepared Statements ──────────────────────────────────────────────────

const stmtInsertComment = db.prepare(
  `INSERT INTO comments (id, taskId, body, status, agentLog, createdAt)
   VALUES (@id, @taskId, @body, @status, @agentLog, @createdAt)`,
);
const stmtGetComment = db.prepare(`SELECT * FROM comments WHERE id = ?`);
const stmtListCommentsByTask = db.prepare(
  `SELECT * FROM comments WHERE taskId = ? ORDER BY createdAt ASC`,
);
const stmtUpdateCommentStatus = db.prepare(
  `UPDATE comments SET status = ? WHERE id = ?`,
);
const stmtUpdateCommentLog = db.prepare(
  `UPDATE comments SET agentLog = ? WHERE id = ?`,
);
const stmtAppendCommentLog = db.prepare(
  `UPDATE comments SET agentLog = json_insert(agentLog, '$[#]', ?) WHERE id = ?`,
);

// ─── Public API ───────────────────────────────────────────────────────────

export function createComment(taskId: string, body: string): Comment {
  const now = new Date().toISOString();
  const comment: Comment = {
    id: `cmt_${randomUUID().slice(0, 8)}`,
    taskId,
    body,
    status: "pending",
    agentLog: [],
    createdAt: now,
  };
  stmtInsertComment.run({
    id: comment.id,
    taskId: comment.taskId,
    body: comment.body,
    status: comment.status,
    agentLog: JSON.stringify(comment.agentLog),
    createdAt: comment.createdAt,
  });
  return comment;
}

export function getComments(taskId: string): Comment[] {
  const rows = stmtListCommentsByTask.all(taskId) as CommentRow[];
  return rows.map(rowToComment);
}

export function getComment(id: string): Comment | null {
  const row = stmtGetComment.get(id) as CommentRow | undefined;
  return row ? rowToComment(row) : null;
}

export function updateComment(
  id: string,
  patch: Partial<Pick<Comment, "status" | "agentLog">>,
): Comment {
  if (patch.status !== undefined) {
    stmtUpdateCommentStatus.run(patch.status, id);
  }
  if (patch.agentLog !== undefined) {
    stmtUpdateCommentLog.run(JSON.stringify(patch.agentLog), id);
  }
  const row = stmtGetComment.get(id) as CommentRow | undefined;
  if (!row) throw new Error(`Comment not found: ${id}`);
  return rowToComment(row);
}

export function appendCommentLog(id: string, line: string): void {
  stmtAppendCommentLog.run(line, id);
}
