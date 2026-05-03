"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import type { WsMessage } from "@/types";

const RECONNECT_DELAY_MS = 3000;

export function useAgentSocket(url?: string) {
  const wsUrl =
    url ?? process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUnmount = useRef(false);

  useEffect(() => {
    closedByUnmount.current = false;

    const {
      upsertTask,
      addTask,
      removeTask,
      appendLog,
      setAgentStatus,
      setWsConnected,
      upsertComment,
      updateProjectPlanningStatus,
      appendToolCall,
      appendAgentText,
      setCloneProgress,
      completeClone,
      failClone,
      setSkillProgress,
      studioStart,
      studioAppend,
      studioFinish,
      studioError,
      upsertNodeRun,
      appendNodeLog,
      setCiIteration,
    } = useBoardStore.getState();

    const resyncTasks = async () => {
      // After (re)connect, the in-memory store may be stale: the server may
      // have rolled tasks back via recoverOrphanedTasks() while no client was
      // listening, or we missed events during the disconnect window. Re-fetch
      // the current project's tasks to converge.
      const { selectedProjectId, setTasks } = useBoardStore.getState();
      if (!selectedProjectId) return;
      try {
        const tasks = await api.getTasks(selectedProjectId);
        setTasks(tasks);
      } catch {
        // best-effort; user can also F5
      }
    };

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        void resyncTasks();
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsMessage | { type: string };
          switch ((msg as { type: string }).type) {
            case "task_updated":
              upsertTask((msg as Extract<WsMessage, { type: "task_updated" }>).payload);
              break;
            case "task_created":
              addTask((msg as Extract<WsMessage, { type: "task_created" }>).payload);
              break;
            case "task_deleted":
              removeTask(
                (msg as Extract<WsMessage, { type: "task_deleted" }>).payload.id,
              );
              break;
            case "agent_log": {
              const m = msg as Extract<WsMessage, { type: "agent_log" }>;
              appendLog(m.taskId, m.payload.line);
              break;
            }
            case "agent_status": {
              const m = msg as Extract<WsMessage, { type: "agent_status" }>;
              setAgentStatus(m.taskId, m.payload);
              break;
            }
            case "agent_tool_call": {
              const m = msg as Extract<WsMessage, { type: "agent_tool_call" }>;
              appendToolCall(m.taskId, m.payload);
              break;
            }
            case "agent_text": {
              const m = msg as Extract<WsMessage, { type: "agent_text" }>;
              appendAgentText(m.taskId, m.payload);
              break;
            }
            case "node_started": {
              const m = msg as Extract<WsMessage, { type: "node_started" }>;
              upsertNodeRun(m.payload);
              break;
            }
            case "node_finished": {
              const m = msg as Extract<WsMessage, { type: "node_finished" }>;
              upsertNodeRun(m.payload);
              break;
            }
            case "node_log": {
              const m = msg as Extract<WsMessage, { type: "node_log" }>;
              appendNodeLog(m.taskId, m.payload.nodeId, m.payload.line);
              break;
            }
            case "comment_updated": {
              const m = msg as Extract<WsMessage, { type: "comment_updated" }>;
              upsertComment(m.payload);
              break;
            }
            case "project_planning_started": {
              const m = msg as Extract<WsMessage, { type: "project_planning_started" }>;
              updateProjectPlanningStatus(m.projectId, "planning");
              break;
            }
            case "project_planning_done": {
              const m = msg as Extract<WsMessage, { type: "project_planning_done" }>;
              updateProjectPlanningStatus(m.projectId, "done");
              break;
            }
            case "project_planning_error": {
              const m = msg as Extract<WsMessage, { type: "project_planning_error" }>;
              updateProjectPlanningStatus(m.projectId, "error", m.error);
              break;
            }
            case "clone_progress": {
              const m = msg as Extract<WsMessage, { type: "clone_progress" }>;
              const { status: cloneStatus, message, project } = m.payload;
              if (cloneStatus === "cloning") {
                setCloneProgress(m.targetPath, message);
              } else if (cloneStatus === "done") {
                completeClone(m.targetPath, project);
              } else {
                failClone(m.targetPath, message);
              }
              break;
            }
            case "skill_install_progress": {
              const m = msg as Extract<WsMessage, { type: "skill_install_progress" }>;
              setSkillProgress({
                projectId: m.projectId,
                pluginId: m.payload.pluginId,
                status: m.payload.status,
                message: m.payload.message,
              });
              break;
            }
            case "studio_generation": {
              const m = msg as Extract<WsMessage, { type: "studio_generation" }>;
              const { generationId, status, chunk, error } = m.payload;
              if (status === "running") {
                if (chunk !== undefined) {
                  studioAppend(chunk);
                } else {
                  studioStart(generationId);
                }
              } else if (status === "done") {
                studioFinish();
              } else if (status === "error") {
                studioError(error ?? "generation failed");
              }
              break;
            }
            case "ci_iteration_started": {
              const m = msg as Extract<WsMessage, { type: "ci_iteration_started" }>;
              setCiIteration(m.taskId, m.payload.iteration, m.payload.maxIterations);
              break;
            }
            case "ci_check_status":
            case "ci_iteration_result":
            case "hello":
            default:
              break;
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        if (closedByUnmount.current) return;
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closedByUnmount.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [wsUrl]);
}
