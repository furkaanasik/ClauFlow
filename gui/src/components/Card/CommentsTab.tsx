"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import type { Comment, CommentStatus, Task } from "@/types";

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;

  if (isToday) return time;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return `Y'day ${time}`;

  const dd = String(date.getDate()).padStart(2, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mo} ${time}`;
}

const STATUS_LABEL: Record<CommentStatus, { label: string; ink: string; pulse: boolean }> = {
  pending: { label: "Queued",        ink: "var(--text-muted)",     pulse: false },
  running: { label: "Agent working", ink: "var(--status-doing)",   pulse: true  },
  done:    { label: "Applied",       ink: "var(--accent-primary)", pulse: false },
  error:   { label: "Error",         ink: "var(--status-error)",   pulse: false },
};

function StatusIndicator({ status }: { status: CommentStatus }) {
  const s = STATUS_LABEL[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium"
      style={{ color: s.ink }}
    >
      <span
        className={clsx("h-1.5 w-1.5", s.pulse && "animate-pulse")}
        style={{ background: s.ink }}
      />
      {s.label}
    </span>
  );
}

function CommentCard({ comment }: { comment: Comment }) {
  const autoOpen = comment.status === "running" || comment.status === "error";
  const [logOpen, setLogOpen] = useState(autoOpen);
  const logRef = useRef<HTMLPreElement | null>(null);

  const hasLog =
    (comment.status === "running" || comment.status === "error") &&
    comment.agentLog.length > 0;

  return (
    <div className="border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
        {comment.body}
      </p>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
        <StatusIndicator status={comment.status} />
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          {formatDate(comment.createdAt)}
        </span>
      </div>

      {hasLog && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
          >
            <span aria-hidden className={clsx("transition-transform", logOpen ? "rotate-90" : "rotate-0")}>
              ▸
            </span>
            {logOpen ? "Hide log" : "Show log"}
          </button>
          {logOpen && (
            <pre
              ref={logRef}
              className="mt-2 max-h-48 overflow-auto border border-[var(--border)] bg-[var(--bg-sunken)] p-3 font-mono text-[11px] leading-relaxed text-[var(--accent-primary)]"
            >
              {comment.agentLog.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

interface CommentsTabProps {
  task: Task;
}

export function CommentsTab({ task }: CommentsTabProps) {
  const upsertComment = useBoardStore((s) => s.upsertComment);
  const comments = task.comments ?? [];

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canComment = task.status === "review" || task.status === "doing";

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const comment = await api.addComment(task.id, trimmed);
      upsertComment(comment);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {comments.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 border border-dashed border-[var(--border)] py-12">
            <p className="t-display text-xl text-[var(--text-secondary)]">
              No comments yet
            </p>
            <p className="text-[12px] text-[var(--text-faint)]">
              Write feedback — the agent re-runs the branch
            </p>
          </div>
        ) : (
          comments.map((c) => <CommentCard key={c.id} comment={c} />)
        )}
      </div>

      {canComment && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--border)] pt-3">
          {error && (
            <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-1.5 text-xs text-[var(--status-error)]">
              {error}
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            rows={3}
            placeholder="Write a fix instruction for the agent…"
            className="w-full resize-none border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--text-secondary)] focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--text-faint)]">
              ⌘ / Ctrl + ↵ to send
            </span>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !body.trim()}
              className="btn-ink px-4 py-1.5 text-[12px] font-medium disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
