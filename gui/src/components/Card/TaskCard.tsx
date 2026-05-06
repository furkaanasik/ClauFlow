"use client";

import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBoardStore } from "@/store/boardStore";
import { calculateCost } from "@/lib/cost";
import type { Task } from "@/types";

/* ── Status dot ──────────────────────────────────────────────────────────── */
const AGENT_STATUS_META: Record<string, { color: string; label: string; pulse: boolean }> = {
  idle:        { color: "#6b7280", label: "Idle",       pulse: false },
  branching:   { color: "#3b82f6", label: "Branching",  pulse: true  },
  running:     { color: "#f59e0b", label: "Running",    pulse: true  },
  pushing:     { color: "#f97316", label: "Pushing",    pulse: true  },
  pr_opening:  { color: "#818cf8", label: "Opening PR", pulse: true  },
  done:        { color: "#22c55e", label: "Done",       pulse: false },
  error:       { color: "#ef4444", label: "Error",      pulse: false },
};

function StatusDot({ agentStatus }: { agentStatus: string }) {
  const meta = AGENT_STATUS_META[agentStatus] ?? AGENT_STATUS_META.idle;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 7, height: 7 }}>
      {meta.pulse && (
        <span style={{
          position: "absolute",
          inset: -3,
          borderRadius: "50%",
          background: meta.color,
          opacity: 0.25,
          animation: "cf-pulse 1.5s ease-in-out infinite",
        }} />
      )}
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
    </span>
  );
}

/* ── Priority badge ──────────────────────────────────────────────────────── */
const PRIORITY_META: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "#ef4444", bg: "rgba(239,68,68,0.15)",   label: "Critical" },
  high:     { color: "#ef4444", bg: "rgba(239,68,68,0.15)",   label: "High"     },
  medium:   { color: "#f59e0b", bg: "rgba(245,158,11,0.15)",  label: "Med"      },
  low:      { color: "#6b7280", bg: "rgba(107,114,128,0.12)", label: "Low"      },
};

function PriorityBadge({ priority }: { priority: string }) {
  const m = PRIORITY_META[(priority ?? "").toLowerCase()] ?? PRIORITY_META.low;
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.04em",
      color: m.color,
      background: m.bg,
      padding: "1px 6px",
      borderRadius: 3,
      textTransform: "uppercase",
    }}>{m.label}</span>
  );
}

/* ── Spinner ─────────────────────────────────────────────────────────────── */
function Spinner({ color = "#818cf8" }: { color?: string }) {
  return (
    <span style={{
      width: 10,
      height: 10,
      border: "2px solid rgba(99,102,241,0.2)",
      borderTop: `2px solid ${color}`,
      borderRadius: "50%",
      display: "inline-block",
      animation: "cf-spin 0.7s linear infinite",
    }} />
  );
}

/* ── Tag ─────────────────────────────────────────────────────────────────── */
function Tag({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 10,
      color: "var(--cf-muted)",
      background: "var(--cf-tag-bg)",
      border: "1px solid var(--cf-border)",
      padding: "1px 6px",
      borderRadius: 3,
      fontFamily: "monospace",
    }}>{label}</span>
  );
}

/* ── TaskCard ────────────────────────────────────────────────────────────── */
interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const selectTask   = useBoardStore((s) => s.selectTask);
  const selectPRTask = useBoardStore((s) => s.selectPRTask);
  const newTaskIds   = useBoardStore((s) => s.newTaskIds);
  const clearNewTaskId = useBoardStore((s) => s.clearNewTaskId);

  const isNew = newTaskIds.has(task.id);
  const [animated, setAnimated] = useState(false);
  const [hovered, setHovered]   = useState(false);

  useEffect(() => {
    if (!isNew) return;
    const frame = requestAnimationFrame(() => setAnimated(true));
    const timer = setTimeout(() => { clearNewTaskId(task.id); }, 500);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentStatus = task.agent?.status ?? "idle";
  const isWorking   = agentStatus !== "idle" && agentStatus !== "done" && agentStatus !== "error";
  const statusMeta  = AGENT_STATUS_META[agentStatus] ?? AGENT_STATUS_META.idle;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
    disabled: isWorking,
  });

  const cardStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const visibleTags = (task.tags ?? []).slice(0, 3);

  return (
    <article
      ref={setNodeRef}
      style={{
        ...cardStyle,
        background: hovered ? "var(--cf-card-hover)" : "var(--cf-card)",
        border: `1px solid ${isDragging ? "#6366f1" : "var(--cf-border)"}`,
        borderRadius: 8,
        padding: "10px 12px",
        cursor: isWorking ? "not-allowed" : "grab",
        opacity: isDragging ? 0.4 : (isNew && !animated ? 0 : 1),
        transition: "background 0.12s, border-color 0.12s, box-shadow 0.12s, opacity 0.5s, transform 0.5s",
        boxShadow: hovered ? "0 4px 16px rgba(0,0,0,0.25)" : "0 1px 3px rgba(0,0,0,0.12)",
        userSelect: "none",
      }}
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) selectTask(task.id); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Row 1: priority + status */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <PriorityBadge priority={task.priority ?? "low"} />
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: statusMeta.color }}>
          <StatusDot agentStatus={agentStatus} />
          {statusMeta.label}
          {isWorking && <Spinner color={statusMeta.color} />}
        </span>
      </div>

      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--cf-text)", lineHeight: 1.4, marginBottom: 8 }}>
        {task.title}
      </div>

      {/* Tags */}
      {visibleTags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          {visibleTags.map((t) => <Tag key={t} label={t} />)}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--cf-muted)", fontFamily: "monospace" }}>
          {task.displayId ?? `#${task.id.slice(0, 7)}`}
        </span>
        <span style={{ flex: 1 }} />
        {task.prNumber && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); selectPRTask(task.id); }}
            style={{ fontSize: 11, color: "#818cf8", background: "none", border: "none", cursor: "pointer", fontFamily: "monospace", padding: 0 }}
          >
            PR #{task.prNumber}
          </button>
        )}
        {task.usage && (
          <span style={{ fontSize: 11, color: "var(--cf-muted)", fontFamily: "monospace", fontWeight: 600 }}>
            ${calculateCost(task.usage).toFixed(4)}
          </span>
        )}
      </div>
    </article>
  );
}
