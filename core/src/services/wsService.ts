import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  AgentStatus,
  Comment,
  Task,
  WsMessage,
} from "../types/index.js";

let wss: WebSocketServer | null = null;

export function attachWebSocket(server: HttpServer): WebSocketServer {
  if (wss) return wss;
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    const hello: WsMessage = {
      type: "hello",
      payload: { serverVersion: "0.1.0" },
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
  broadcast({ type: "task_updated", taskId: task.id, payload: task });
}

export function broadcastTaskCreated(task: Task): void {
  broadcast({ type: "task_created", taskId: task.id, payload: task });
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

export function closeWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) return resolve();
    wss.close(() => resolve());
    wss = null;
  });
}
