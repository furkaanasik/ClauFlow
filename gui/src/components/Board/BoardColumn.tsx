"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard } from "@/components/Card/TaskCard";
import type { Task, TaskStatus } from "@/types";

interface BoardColumnProps {
  status: TaskStatus;
  title: string;
  numeral: string;
  tasks: Task[];
  onAddTask?: () => void;
}

const COL_META: Record<TaskStatus, { dot: string; label: string }> = {
  todo:   { dot: "var(--cf-muted)",   label: "Todo"   },
  doing:  { dot: "#f59e0b",           label: "Doing"  },
  ci:     { dot: "#3b82f6",           label: "CI"     },
  review: { dot: "#f97316",           label: "Review" },
  done:   { dot: "#22c55e",           label: "Done"   },
};

export function BoardColumn({ status, tasks, onAddTask }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });
  const meta = COL_META[status];

  return (
    <div
      style={{
        width: 264,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* Column header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 2px 10px 2px",
        }}
      >
        <span
          style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot, flexShrink: 0 }}
          aria-hidden
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--cf-text)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {meta.label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--cf-muted)",
            background: "var(--cf-tag-bg)",
            border: "1px solid var(--cf-border)",
            borderRadius: 4,
            padding: "0 6px",
            marginLeft: 2,
          }}
        >
          {tasks.length}
        </span>
        <span style={{ flex: 1 }} />
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 80,
          padding: "8px 0",
          borderRadius: 8,
          border: isOver ? "2px dashed #6366f1" : "2px dashed transparent",
          background: isOver ? "rgba(99,102,241,0.05)" : "transparent",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <SortableContext
          id={status}
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length === 0 && !isOver && (
            <div
              style={{
                textAlign: "center",
                padding: "32px 16px",
                color: "var(--cf-muted)",
                fontSize: 12,
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.4 }}>◻</div>
              Drop tasks here
            </div>
          )}
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
      </div>

      {/* Add task button */}
      <button
        type="button"
        onClick={onAddTask}
        style={{
          marginTop: 8,
          width: "100%",
          padding: "7px",
          background: "transparent",
          border: "1px dashed var(--cf-border)",
          borderRadius: 7,
          color: "var(--cf-muted)",
          fontSize: 12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          transition: "border-color 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#818cf8";
          e.currentTarget.style.color = "#818cf8";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--cf-border)";
          e.currentTarget.style.color = "var(--cf-muted)";
        }}
      >
        + Add task
      </button>
    </div>
  );
}
