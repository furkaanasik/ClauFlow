"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useToastStore } from "@/hooks/useToast";
import { useNotificationStore } from "@/hooks/useNotification";
import { tr } from "@/lib/i18n/tr";
import { en } from "@/lib/i18n/en";
import { formatUsd } from "@/lib/format";
import { errorText } from "@/lib/errorText";
import type { Task, WsMessage } from "@/types";

const RECONNECT_DELAY_MS = 3000;

/** Toast for a live planner/budget event. Names the project when it isn't the open one. */
function plannerToast(projectId: string, type: "success" | "error", message: string, fallbackName?: string) {
  const { projects, selectedProjectId } = useBoardStore.getState();
  const name =
    projectId === selectedProjectId
      ? null
      : (projects.find((p) => p.id === projectId)?.name ?? fallbackName ?? null);
  useToastStore.getState().push(type, name ? `${name}: ${message}` : message);
}

function plannerStrings() {
  return (useBoardStore.getState().lang === "en" ? en : tr).board.planner;
}

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
      upsertNodeRun,
      setBudgetExceeded,
      setBreakdownStatus,
      upsertTeamRun,
      upsertTeamArtifact,
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
            case "task_updated": {
              const t = (msg as Extract<WsMessage, { type: "task_updated" }>).payload;
              // Read the previous copy before upserting. Notify only when the task
              // leaves the Doing column with a finished agent; title edits, drags and
              // tasks of other projects (no `prev`) stay silent.
              const prev: Task | undefined = useBoardStore.getState().tasks[t.id];
              upsertTask(t);
              if (t.agent.status === "idle" && t.status === "doing") {
                useBoardStore.getState().clearBudgetExceeded(t.id);
              }
              const finished = t.agent.status === "done" || t.agent.status === "error";
              if (prev?.status === "doing" && t.status !== "doing" && finished) {
                const isError = t.agent.status === "error";
                useNotificationStore.getState().notify(
                  isError ? `Error: ${t.title}` : `Done: ${t.title}`,
                  isError
                    ? (t.agent.error
                        ? errorText(useBoardStore.getState().lang === "en" ? en : tr, t.agent.error)
                        : "Agent encountered an error")
                    : "Agent finished successfully",
                );
              }
              break;
            }
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
            case "team_run_updated": {
              const m = msg as Extract<WsMessage, { type: "team_run_updated" }>;
              upsertTeamRun(m.payload);
              break;
            }
            case "team_artifact": {
              const m = msg as Extract<WsMessage, { type: "team_artifact" }>;
              upsertTeamArtifact(m.payload);
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
              plannerToast(
                m.projectId,
                "success",
                plannerStrings().doneToast.replace("{count}", String(m.taskCount)),
              );
              break;
            }
            case "project_planning_error": {
              const m = msg as Extract<WsMessage, { type: "project_planning_error" }>;
              updateProjectPlanningStatus(m.projectId, "error", m.error);
              const err = m.error.length > 140 ? `${m.error.slice(0, 140)}…` : m.error;
              plannerToast(m.projectId, "error", plannerStrings().errorToast.replace("{error}", err));
              break;
            }
            case "task_breakdown_started": {
              const m = msg as Extract<WsMessage, { type: "task_breakdown_started" }>;
              setBreakdownStatus(m.taskId, "breaking");
              break;
            }
            case "task_breakdown_done": {
              const m = msg as Extract<WsMessage, { type: "task_breakdown_done" }>;
              setBreakdownStatus(m.taskId, "done");
              break;
            }
            case "task_breakdown_error": {
              const m = msg as Extract<WsMessage, { type: "task_breakdown_error" }>;
              setBreakdownStatus(m.taskId, "error");
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
            case "budget_exceeded": {
              const m = msg as Extract<WsMessage, { type: "budget_exceeded" }>;
              setBudgetExceeded(m.taskId, m.payload);
              const p = m.payload;
              const strings = useBoardStore.getState().lang === "en" ? en : tr;
              const message = strings.board.budgetToast(
                p.displayId ?? p.taskTitle,
                formatUsd(p.spentUsd),
                formatUsd(p.budgetUsd),
              );
              plannerToast(p.projectId, "error", message, p.projectName);
              break;
            }
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
