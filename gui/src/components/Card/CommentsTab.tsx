"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { StatusPill, type StatusKind } from "@/components/ui/Pills";
import { Avatar } from "@/components/ui/Avatar";
import { IconChat, IconChevronRight, IconLock } from "@/components/ui/icons";
import { LogViewer } from "@/components/Card/LogViewer";
import { AttachmentInput, useStagedImages } from "@/components/Attachments/AttachmentInput";
import { AttachmentGrid } from "@/components/Attachments/AttachmentGrid";
import { toGridImages } from "@/components/Attachments/TaskAttachments";
import { apiErrorCode, errorText } from "@/lib/errorText";
import { ATTACHMENT_MAX_PER_TASK } from "@/lib/attachments";
import type { Comment, CommentStatus, Task, TaskAttachment } from "@/types";

function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6} |^\*\*|^- |^```|\*\*|\[.+\]\(|^>/m.test(text);
}

function formatDate(isoString: string, yesterdayLabel: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `${yesterdayLabel} ${time}`;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")} ${time}`;
}

const STATUS_KIND: Record<CommentStatus, StatusKind> = {
  pending: "todo",
  running: "doing",
  done: "done",
  error: "error",
};

function CommentCard({ comment, images }: { comment: Comment; images: TaskAttachment[] }) {
  const t = useTranslation();
  const c = t.comments;
  const autoOpen = comment.status === "running" || comment.status === "error";
  const [logOpen, setLogOpen] = useState(autoOpen);
  const logId = useId();
  const label: Record<CommentStatus, string> = {
    pending: c.queued,
    running: c.working,
    done: c.applied,
    error: c.failed,
  };

  const hasLog = (comment.status === "running" || comment.status === "error") && comment.agentLog.length > 0;

  return (
    <li className="flex gap-3">
      <Avatar name={c.you} size="sm" />
      <article className="cmt min-w-0 flex-1" data-status={comment.status}>
        <div className="px-4 pb-3 pt-3.5">
          {comment.status === "done" && looksLikeMarkdown(comment.body) ? (
            <div className="comment-markdown text-[13.5px] leading-relaxed text-ink">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{comment.body}</p>
          )}
          {images.length > 0 && (
            <AttachmentGrid
              images={toGridImages(images, t.attachments.unnamed)}
              label={t.attachments.commentImages}
              size="sm"
              className="mt-2.5"
            />
          )}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t-2 border-dashed border-hair px-4 py-2">
          <StatusPill status={STATUS_KIND[comment.status]} live={comment.status === "running"}>
            {label[comment.status]}
          </StatusPill>
          <span className="flex items-center gap-2">
            {hasLog && (
              <button
                type="button"
                aria-expanded={logOpen}
                aria-controls={logId}
                onClick={() => setLogOpen((v) => !v)}
                className="ui-focus inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold text-ink-2 transition hover:bg-hair hover:text-ink"
              >
                <IconChevronRight size={12} className={clsx("transition-transform", logOpen && "rotate-90")} />
                {logOpen ? c.hideLog : c.showLog}
              </button>
            )}
            <time dateTime={comment.createdAt} className="font-mono text-[11px] text-ink-3">
              {formatDate(comment.createdAt, c.yesterday)}
            </time>
          </span>
        </footer>
        {hasLog && logOpen && (
          <div id={logId} className="px-3 pb-3">
            <LogViewer
              lines={comment.agentLog}
              follow
              live={comment.status === "running"}
              followLabel={t.taskDetail.follow}
              className="h-48"
            />
          </div>
        )}
      </article>
    </li>
  );
}

interface CommentsTabProps {
  task: Task;
}

export function CommentsTab({ task }: CommentsTabProps) {
  const t = useTranslation();
  const c = t.comments;
  const upsertComment = useBoardStore((s) => s.upsertComment);
  const comments = task.comments ?? [];
  const inputId = useId();

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const images = useStagedImages();
  const taskImages = task.attachments ?? [];

  // §3/12: review always; done only for an unmerged local branch; never while running.
  const canComment =
    task.status === "review" || (task.status === "done" && !!task.branch && !task.prNumber);

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      // bakim #8 (plan §3/26): images go up as drafts first, then the comment links
      // them before its runner starts. Drafts that went up survive a failed send
      // and are reused on retry.
      const ids: string[] = [];
      for (const [i, img] of images.items.entries()) {
        if (img.uploadedId) {
          ids.push(img.uploadedId);
          continue;
        }
        try {
          const att = await api.uploadAttachment(task.id, img.file, { pending: true });
          images.markUploaded(img.key, att.id);
          ids.push(att.id);
        } catch (err) {
          setError(t.attachments.fileError(img.file.name || t.attachments.unnamed(i + 1), errorText(t, err)));
          return;
        }
      }
      const comment = await api.addComment(task.id, trimmed, ids);
      // The runner starts right after the response; its comment_updated can beat this
      // response here. A comment never goes back to pending, so keep the newer copy.
      const seen = useBoardStore.getState().tasks[task.id]?.comments?.find((x) => x.id === comment.id);
      if (!seen || seen.status === "pending") upsertComment(comment);
      setBody("");
      images.clear();
      if (ids.length > 0) {
        try { useBoardStore.getState().upsertTask(await api.getTask(task.id)); } catch { /* task_updated arrives anyway */ }
      }
    } catch (err) {
      // a draft that is no longer linkable (swept, other task): upload it again next time
      if (apiErrorCode(err) === "attachment_not_pending") images.forgetUploads();
      setError(errorText(t, err, c.sendFailed));
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1 pr-1">
        {comments.length === 0 ? (
          <div className="ui-hatch flex flex-1 flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-12 text-center">
            <span
              aria-hidden
              className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-panel text-ink-2 shadow-hard"
            >
              <IconChat size={20} />
            </span>
            <p className="t-display text-[19px] text-ink">{c.emptyTitle}</p>
            <p className="max-w-xs text-[13px] text-ink-2">{c.emptyHint}</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {comments.map((cm) => (
              <CommentCard key={cm.id} comment={cm} images={taskImages.filter((a) => a.commentId === cm.id)} />
            ))}
          </ol>
        )}
      </div>

      {canComment ? (
        <div className="shrink-0 rounded-[14px] border-2 border-line bg-panel p-3 shadow-hard">
          {error && (
            <div role="alert" className="ui-banner ui-banner--error mb-2.5">
              {error}
            </div>
          )}
          <label htmlFor={inputId} className="t-label mb-1.5 block">
            {c.composerLabel}
          </label>
          <AttachmentInput
            remaining={ATTACHMENT_MAX_PER_TASK - taskImages.length - images.items.length}
            onAdd={images.add}
            staged={images.items}
            onRemoveStaged={images.remove}
            disabled={sending}
          >
            <Textarea
              id={inputId}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={3}
              placeholder={c.placeholder}
              className="resize-none"
            />
          </AttachmentInput>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <Kbd>Ctrl</Kbd>
              <Kbd>↵</Kbd>
              {c.sendHint}
            </span>
            <Button
              variant="primary"
              size="sm"
              icon={<IconChat size={14} />}
              loading={sending}
              disabled={!body.trim()}
              onClick={() => void handleSend()}
            >
              {sending ? c.sending : c.send}
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex shrink-0 items-center gap-2 rounded-[10px] border-2 border-dashed border-hair px-3 py-2 text-[12.5px] text-ink-3">
          <IconLock size={13} />
          {task.status === "doing" ? c.runningReadOnly : c.readOnly}
        </p>
      )}
    </div>
  );
}
