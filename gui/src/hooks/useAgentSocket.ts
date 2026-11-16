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
import { blockerProblem, isWaitingDeps } from "@/lib/boardView";
import { refreshStashes } from "@/hooks/useStashes";
import type { Task, WsMessage } from "@/types";

const RECONNECT_DELAY_MS = 3000;

/** zincir D6: one blocker notification per failure (`${taskId}:${finishedAt}`), §3/12. */
const chainBlockedNotified = new Set<string>();

/**
 * zincir D6: a dependency just got into trouble (§3/11) while tasks of the open
 * project wait for it → one browser notification. Other projects are not in
 * the store, so they stay silent (known limit; the card badge is permanent).
 */
function notifyChainBlocked(prev: Task | undefined, t: Task) {
  if (!prev || !blockerProblem(t) || blockerProblem(prev)) return;
  const { tasks } = useBoardStore.getState();
  const waiting = Object.values(tasks).filter((x) => x && isWaitingDeps(x) && x.dependsOn?.includes(t.id));
  if (waiting.length === 0) return;
  const key = `${t.id}:${t.agent.finishedAt ?? ""}`;
  if (chainBlockedNotified.has(key)) return;
  chainBlockedNotified.add(key);
  const s = uiStrings();
  useNotificationStore.getState().notify(
    s.notifications.chainBlocked(
      t.displayId ?? t.title,
      waiting.map((x) => x.displayId ?? x.title),
    ),
    t.agent.error ? errorText(s, t.agent.error) : s.notifications.taskErrorBody,
  );
}

/** zincir F4.6 (§3/43): one notice per resolver run end (`${taskId}:${finishedAt}`). */
const conflictNotified = new Set<string>();
/**
 * Tasks seen in `resolving_conflict`. `agent_status` arrives before the final
 * `task_updated` and already flips the stored copy to done/error, so the
 * previous copy alone would miss the transition.
 */
const resolvingSeen = new Set<string>();

/** zincir F4.6 (§3/43): the AI conflict resolver finished (no extra WS event, §3/12 pattern). */
function notifyConflictEnd(prev: Task | undefined, t: Task) {
  if (t.agent.status === "resolving_conflict") {
    resolvingSeen.add(t.id);
    return;
  }
  const wasResolving = prev?.agent.status === "resolving_conflict" || resolvingSeen.has(t.id);
  if (!wasResolving) return;
  resolvingSeen.delete(t.id);
  const failed = t.agent.status === "error";
  const resolved = t.agent.status === "done" && t.agent.currentStep === "conflict_resolved";
  // A clean merge (no AI, no QA, §3/39) ends as `branch_updated`.
  const updated = t.agent.status === "done" && t.agent.currentStep === "branch_updated";
  if (!failed && !resolved && !updated) return;
  const once = `${t.id}:${t.agent.finishedAt ?? ""}`;
  if (conflictNotified.has(once)) return;
  conflictNotified.add(once);
  const s = uiStrings();
  const key = t.displayId ?? t.title;
  const { projects, selectedProjectId } = useBoardStore.getState();
  const name = t.projectId === selectedProjectId ? null : (projects.find((p) => p.id === t.projectId)?.name ?? null);
  const withProject = (message: string) => (name ? `${name}: ${message}` : message);
  if (failed) {
    const reason = t.agent.error ? errorText(s, t.agent.error) : s.notifications.taskErrorBody;
    useNotificationStore.getState().notify(s.notifications.conflictUnresolved(key), reason);
    useToastStore.getState().push("error", withProject(s.notifications.runFailedToast(key, reason)), 8000);
  } else if (updated) {
    useToastStore.getState().push("success", withProject(s.notifications.branchUpdated(key)), 6000);
  } else {
    useToastStore.getState().push("success", withProject(s.notifications.conflictResolved(key)), 6000);
  }
}

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

function uiStrings() {
  return useBoardStore.getState().lang === "en" ? en : tr;
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
              notifyChainBlocked(prev, t);
              notifyConflictEnd(prev, t);
              if (t.agent.status === "idle" && t.status === "doing") {
                useBoardStore.getState().clearBudgetExceeded(t.id);
              }
              const finished = t.agent.status === "done" || t.agent.status === "error";
              if (prev?.status === "doing" && t.status !== "doing" && finished) {
                const isError = t.agent.status === "error";
                const s = uiStrings();
                const reason = t.agent.error ? errorText(s, t.agent.error) : s.notifications.taskErrorBody;
                useNotificationStore.getState().notify(
                  isError ? s.notifications.taskError(t.title) : s.notifications.taskDone(t.title),
                  isError ? reason : s.notifications.taskDoneBody,
                );
                // zincir F0.5: the notification may be off or unseen; a failed run
                // also gets an in-app toast with the translated reason.
                if (isError) {
                  const { projects, selectedProjectId } = useBoardStore.getState();
                  const name =
                    t.projectId === selectedProjectId ? null : (projects.find((p) => p.id === t.projectId)?.name ?? null);
                  const message = s.notifications.runFailedToast(t.displayId ?? t.title, reason);
                  useToastStore.getState().push("error", name ? `${name}: ${message}` : message, 8000);
                }
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
              // zincir F4.6: remember a running resolver before this frame overwrites it.
              if (m.payload.status === "resolving_conflict" ||
                  useBoardStore.getState().tasks[m.taskId]?.agent.status === "resolving_conflict") {
                resolvingSeen.add(m.taskId);
              }
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
            case "chain_advanced": {
              const m = msg as Extract<WsMessage, { type: "chain_advanced" }>;
              const p = m.payload;
              const from = p.displayId ?? m.taskId;
              const started = p.started.map((x) => x.displayId ?? x.id);
              if (started.length > 0) {
                plannerToast(p.projectId, "success", uiStrings().board.chainAdvanced(from, started, p.merged));
              }
              break;
            }
            case "stash_created": {
              // zincir E6 (plan §3/28): info toast (6 s) + the project's stash counter.
              const m = msg as Extract<WsMessage, { type: "stash_created" }>;
              const p = m.payload;
              const { projects, selectedProjectId } = useBoardStore.getState();
              const text = uiStrings().stashes.createdToast(p.displayId);
              const name = p.projectId === selectedProjectId ? null : projects.find((x) => x.id === p.projectId)?.name;
              useToastStore.getState().push("info", name ? `${name}: ${text}` : text, 6000);
              void refreshStashes(p.projectId);
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
