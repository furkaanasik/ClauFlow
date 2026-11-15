import { createRequire } from "node:module";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const _require = createRequire(import.meta.url);
const _pkg = _require("../../package.json") as { version: string };
const SERVER_VERSION: string = _pkg.version ?? "0.0.0";
import type {
  AgentStatus,
  BudgetExceededPayload,
  AgentText,
  Comment,
  NodeRun,
  Project,
  Task,
  TeamArtifact,
  TeamRun,
  ToolCall,
  WsMessage,
} from "../types/index.js";

let wss: WebSocketServer | null = null;

const ALLOWED_WS_ORIGINS = (
  process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((s) => s.trim());

export function attachWebSocket(server: HttpServer): WebSocketServer {
  if (wss) return wss;
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket, req) => {
    const origin = req.headers.origin ?? "";
    if (origin && !ALLOWED_WS_ORIGINS.includes(origin)) {
      socket.close(1008, "Forbidden origin");
      return;
    }
    const hello: WsMessage = {
      type: "hello",
      payload: { serverVersion: SERVER_VERSION },
    };
    socket.send(JSON.stringify(hello));
  });
  return wss;
}

export function broadcast(message: WsMessage): void {
  if (!wss) return;
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function broadcastLog(taskId: string, line: string): void {
  broadcast({ type: "agent_log", taskId, payload: { line } });
}

export function broadcastStatus(
  taskId: string,
  status: AgentStatus,
  currentStep?: string,
): void {
  broadcast({
    type: "agent_status",
    taskId,
    payload: currentStep ? { status, currentStep } : { status },
  });
}

export function broadcastTaskUpdated(task: Task): void {
  const stripped: Task = {
    ...task,
    agent: { ...task.agent, log: [] },
  };
  broadcast({ type: "task_updated", taskId: task.id, payload: stripped });
}

export function broadcastTaskCreated(task: Task): void {
  const stripped: Task = { ...task, agent: { ...task.agent, log: [] } };
  broadcast({ type: "task_created", taskId: task.id, payload: stripped });
}

export function broadcastTaskDeleted(id: string): void {
  broadcast({ type: "task_deleted", taskId: id, payload: { id } });
}

export function broadcastCommentUpdated(comment: Comment): void {
  broadcast({
    type: "comment_updated",
    taskId: comment.taskId,
    payload: comment,
  });
}

export function broadcastToolCall(toolCall: ToolCall): void {
  broadcast({
    type: "agent_tool_call",
    taskId: toolCall.taskId,
    payload: toolCall,
  });
}

export function broadcastAgentText(agentText: AgentText): void {
  broadcast({
    type: "agent_text",
    taskId: agentText.taskId,
    payload: agentText,
  });
}

export function broadcastProjectPlanningStarted(projectId: string): void {
  broadcast({ type: "project_planning_started", projectId });
}

export function broadcastProjectPlanningDone(
  projectId: string,
  taskCount: number,
): void {
  broadcast({ type: "project_planning_done", projectId, taskCount });
}

export function broadcastProjectPlanningError(
  projectId: string,
  error: string,
): void {
  broadcast({ type: "project_planning_error", projectId, error });
}

export function broadcastTaskBreakdownStarted(taskId: string): void {
  broadcast({ type: "task_breakdown_started", taskId });
}

export function broadcastTaskBreakdownDone(taskId: string, taskCount: number): void {
  broadcast({ type: "task_breakdown_done", taskId, taskCount });
}

export function broadcastTaskBreakdownError(taskId: string, error: string): void {
  broadcast({ type: "task_breakdown_error", taskId, error });
}

export function broadcastCloneProgress(
  targetPath: string,
  status: "cloning" | "done" | "error",
  message: string,
  project?: Project,
): void {
  broadcast({
    type: "clone_progress",
    targetPath,
    payload: project ? { status, message, project } : { status, message },
  });
}

export function broadcastNodeStarted(nodeRun: NodeRun): void {
  broadcast({
    type: "node_started",
    taskId: nodeRun.taskId,
    payload: nodeRun,
  });
}

export function broadcastNodeFinished(nodeRun: NodeRun): void {
  broadcast({
    type: "node_finished",
    taskId: nodeRun.taskId,
    payload: nodeRun,
  });
}

export function broadcastTeamRunUpdated(run: TeamRun): void {
  broadcast({ type: "team_run_updated", taskId: run.taskId, payload: run });
}

export function broadcastTeamArtifact(artifact: TeamArtifact): void {
  broadcast({ type: "team_artifact", taskId: artifact.taskId, payload: artifact });
}

export function broadcastBudgetExceeded(taskId: string, payload: BudgetExceededPayload): void {
  broadcast({ type: "budget_exceeded", taskId, payload });
}

export function closeWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) return resolve();
    wss.close(() => resolve());
    wss = null;
  });
}
