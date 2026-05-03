import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type {
  AgentStatus,
  AgentText,
  Comment,
  NodeRun,
  Project,
  Task,
  ToolCall,
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
  const stripped: Task = {
    ...task,
    agent: { ...task.agent, log: [] },
  };
  broadcast({ type: "task_updated", taskId: task.id, payload: stripped });
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

export function broadcastStudioGeneration(payload: {
  generationId: string;
  status: "running" | "done" | "error";
  chunk?: string;
  error?: string;
}): void {
  broadcast({ type: "studio_generation", payload });
}

export function broadcastSkillInstallProgress(
  projectId: string,
  pluginId: string,
  status: "running" | "done" | "error",
  message: string,
): void {
  broadcast({
    type: "skill_install_progress",
    projectId,
    payload: { pluginId, status, message },
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

export function broadcastNodeLog(
  taskId: string,
  nodeId: string,
  line: string,
): void {
  broadcast({
    type: "node_log",
    taskId,
    payload: { nodeId, line },
  });
}

export function broadcastCiCheckStatus(
  taskId: string,
  prNumber: number,
  verdict: import("../types/index.js").CiVerdict,
): void {
  broadcast({ type: "ci_check_status", taskId, payload: { prNumber, verdict } });
}

export function broadcastCiIterationStarted(
  taskId: string,
  iteration: number,
  maxIterations: number,
): void {
  broadcast({
    type: "ci_iteration_started",
    taskId,
    payload: { iteration, maxIterations },
  });
}

export function broadcastCiIterationResult(
  taskId: string,
  iteration: number,
  outcome: "pass" | "fail" | "exhausted",
): void {
  broadcast({
    type: "ci_iteration_result",
    taskId,
    payload: { iteration, outcome },
  });
}

export function closeWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) return resolve();
    wss.close(() => resolve());
    wss = null;
  });
}
