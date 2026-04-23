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

  if (isYesterday) return `Dun ${time}`;

  const dd = String(date.getDate()).padStart(2, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mo} ${time}`;
}

interface StatusIndicatorProps {
  status: CommentStatus;
}

function StatusIndicator({ status }: StatusIndicatorProps) {
  switch (status) {
    case "pending":
      return (
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
          Bekliyor
        </span>
      );
    case "running":
      return (
        <span className="flex items-center gap-1.5 text-[11px] text-yellow-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
          AI duzzeltiyor...
        </span>
      );
    case "done":
      return (
        <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="2 6 5 9 10 3" />
          </svg>
          Tamamlandi
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1.5 text-[11px] text-red-400">
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 2l8 8M10 2L2 10" />
          </svg>
          Hata
        </span>
      );
  }
}

interface CommentCardProps {
  comment: Comment;
}

function CommentCard({ comment }: CommentCardProps) {
  const autoOpen =
    comment.status === "running" || comment.status === "error";
  const [logOpen, setLogOpen] = useState(autoOpen);
  const logRef = useRef<HTMLPreElement | null>(null);

  const hasLog =
    (comment.status === "running" || comment.status === "error") &&
    comment.agentLog.length > 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="mb-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
        {comment.body}
      </p>
      <div className="flex items-center justify-between gap-2">
        <StatusIndicator status={comment.status} />
        <span className="font-mono text-[10px] text-zinc-600">
          {formatDate(comment.createdAt)}
        </span>
      </div>

      {hasLog && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="currentColor"
              className={clsx(
                "transition-transform",
                logOpen ? "rotate-90" : "rotate-0",
              )}
              aria-hidden="true"
            >
              <path d="M3 2l4 3-4 3V2z" />
            </svg>
            {logOpen ? "Logu gizle" : "Logu goster"}
          </button>
          {logOpen && (
            <pre
              ref={logRef}
              className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-black p-3 font-mono text-[11px] leading-relaxed text-emerald-400"
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

  const canComment =
    task.status === "review" || task.status === "doing";

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
      setError(
        err instanceof Error ? err.message : "Yorum gonderilemedi.",
      );
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
    <div className="flex h-full flex-col gap-3 px-5 py-4">
      {/* Yorum listesi */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {comments.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-800 py-10 text-xs text-zinc-700">
            Henuz yorum yok
          </div>
        ) : (
          comments.map((c) => <CommentCard key={c.id} comment={c} />)
        )}
      </div>

      {/* Yorum formu */}
      {canComment && (
        <div className="shrink-0 flex flex-col gap-2 border-t border-zinc-800 pt-3">
          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            rows={3}
            placeholder="AI'ya duzeltme talimati yaz..."
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-700">Ctrl+Enter ile gonder</span>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !body.trim()}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {sending ? "Gonderiliyor..." : "Gonder"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
