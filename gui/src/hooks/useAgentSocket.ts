"use client";

import { useEffect, useRef } from "react";
import { useBoardStore } from "@/store/boardStore";
import type { WsEvent } from "@/types";

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
      removeTask,
      appendLog,
      setAgentStatus,
      setWsConnected,
      upsertComment,
    } = useBoardStore.getState();

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsEvent | { type: string };
          switch ((msg as { type: string }).type) {
            case "task_updated":
            case "task_created":
              upsertTask((msg as Extract<WsEvent, { type: "task_updated" }>).payload);
              break;
            case "task_deleted":
              removeTask(
                (msg as Extract<WsEvent, { type: "task_deleted" }>).payload.id,
              );
              break;
            case "agent_log": {
              const m = msg as Extract<WsEvent, { type: "agent_log" }>;
              appendLog(m.taskId, m.payload.line);
              break;
            }
            case "agent_status": {
              const m = msg as Extract<WsEvent, { type: "agent_status" }>;
              setAgentStatus(m.taskId, m.payload);
              break;
            }
            case "comment_updated": {
              const m = msg as Extract<WsEvent, { type: "comment_updated" }>;
              upsertComment(m.payload);
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
