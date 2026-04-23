"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommentsTab } from "@/components/Card/CommentsTab";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import type { Task, TaskPatch } from "@/types";

type EditPriority = "low" | "medium" | "high" | "critical";
type DrawerTab = "details" | "log" | "comments";

interface DraftState {
  title: string;
  description: string;
  analysis: string;
  priority: EditPriority;
}

function priorityTone(priority?: string | null): BadgeTone {
  switch ((priority ?? "").toLowerCase()) {
    case "critical":
    case "high":   return "red";
    case "medium": return "yellow";
    case "low":    return "green";
    default:       return "neutral";
  }
}

function statusTone(status: Task["status"]): BadgeTone {
  switch (status) {
    case "doing":  return "yellow";
    case "review": return "purple";
    case "done":   return "green";
    default:       return "neutral";
  }
}

function normalizePriority(p?: string | null): EditPriority {
  const v = (p ?? "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return "medium";
}

function makeDraft(task: Task): DraftState {
  return {
    title:       task.title,
    description: task.description ?? "",
    analysis:    task.analysis ?? "",
    priority:    normalizePriority(task.priority),
  };
}

const PRIORITY_BUTTONS: { value: EditPriority; label: string; color: string }[] = [
  { value: "low",      label: "Dusuk",  color: "text-emerald-400 border-emerald-700 bg-emerald-950/40" },
  { value: "medium",   label: "Orta",   color: "text-yellow-400  border-yellow-700  bg-yellow-950/40"  },
  { value: "high",     label: "Yuksek", color: "text-orange-400  border-orange-700  bg-orange-950/40"  },
  { value: "critical", label: "Kritik", color: "text-red-400     border-red-700     bg-red-950/40"     },
];

export function TaskDetailDrawer() {
  const selectedTaskId = useBoardStore((s) => s.selectedTaskId);
  const task           = useBoardStore((s) =>
    s.selectedTaskId ? s.tasks[s.selectedTaskId] ?? null : null,
  );
  const projects    = useBoardStore((s) => s.projects);
  const selectTask    = useBoardStore((s) => s.selectTask);
  const upsertTask    = useBoardStore((s) => s.upsertTask);
  const removeTask    = useBoardStore((s) => s.removeTask);
  const upsertComment = useBoardStore((s) => s.upsertComment);

  const [editing,       setEditing]       = useState(false);
  const [draft,         setDraft]         = useState<DraftState | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [retrying,      setRetrying]      = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [tab,           setTab]           = useState<DrawerTab>("details");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = Boolean(selectedTaskId);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setError(null);
    setSaving(false);
    setDeleting(false);
    setTab("details");
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    api.getComments(selectedTaskId).then((comments) => {
      comments.forEach((c) => upsertComment(c));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);

  const close = () => selectTask(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [task?.agent.log?.length]);

  const beginEdit  = () => { if (!task) return; setDraft(makeDraft(task)); setEditing(true); setError(null); };
  const cancelEdit = () => { setEditing(false); setDraft(null); setError(null); };

  const saveEdit = async () => {
    if (!task || !draft) return;
    if (!draft.title.trim()) { setError("Baslik zorunludur."); return; }
    setSaving(true);
    setError(null);
    try {
      const patch: TaskPatch = {
        title:       draft.title.trim(),
        description: draft.description,
        analysis:    draft.analysis,
        priority:    draft.priority,
      };
      const updated = await api.updateTask(task.id, patch);
      upsertTask(updated);
      setEditing(false);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Guncelleme basarisiz.");
    } finally {
      setSaving(false);
    }
  };

  const doRetry = async () => {
    if (!task) return;
    setRetrying(true);
    setError(null);
    try {
      const updated = await api.retryTask(task.id);
      upsertTask(updated);
      setTab("log");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Yeniden deneme basarisiz.");
    } finally {
      setRetrying(false);
    }
  };

  const doDelete = async () => {
    if (!task) return;
    setConfirmDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTask(task.id);
      removeTask(task.id);
      selectTask(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Silme basarisiz.");
      setDeleting(false);
    }
  };

  const logs         = useMemo(() => task?.agent.log ?? [], [task?.agent.log]);
  const commentCount = task?.comments?.length ?? 0;
  const projectName  = task ? (projects.find((p) => p.id === task.projectId)?.name ?? "") : "";

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={clsx(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl",
          "transform transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
      >
        {task ? (
          <>
            {/* Header */}
            <header className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0 flex-1">
                {/* Meta bilgiler */}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                  {task.priority && !editing && (
                    <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
                  )}
                  {projectName && (
                    <span className="text-[10px] text-zinc-600">{projectName}</span>
                  )}
                  <span className="font-mono text-[10px] text-zinc-700">#{task.id.slice(0, 8)}</span>
                </div>
                {/* Baslik */}
                {editing && draft ? (
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base font-semibold text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                    placeholder="Baslik"
                  />
                ) : (
                  <h2 className="text-base font-semibold leading-tight text-zinc-100">
                    {task.title}
                  </h2>
                )}
              </div>
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Kapat"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </header>

            {/* Sekmeler */}
            <div className="flex border-b border-zinc-800">
              <button
                type="button"
                onClick={() => setTab("details")}
                className={clsx(
                  "px-4 py-2.5 text-xs font-medium transition",
                  tab === "details"
                    ? "border-b-2 border-blue-500 text-blue-400"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                Detaylar
              </button>
              <button
                type="button"
                onClick={() => setTab("log")}
                className={clsx(
                  "px-4 py-2.5 text-xs font-medium transition",
                  tab === "log"
                    ? "border-b-2 border-blue-500 text-blue-400"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {`Agent Logu${logs.length > 0 ? ` (${logs.length})` : ""}`}
              </button>
              <button
                type="button"
                onClick={() => setTab("comments")}
                className={clsx(
                  "px-4 py-2.5 text-xs font-medium transition",
                  tab === "comments"
                    ? "border-b-2 border-blue-500 text-blue-400"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {commentCount > 0 ? `Yorumlar (${commentCount})` : "Yorumlar"}
              </button>
            </div>

            {/* Icerik */}
            <div className="flex-1 overflow-y-auto">
              {tab === "comments" ? (
                <CommentsTab task={task} />
              ) : tab === "details" ? (
                <div className="px-5 py-4">
                  {error && (
                    <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                      {error}
                    </div>
                  )}

                  {/* Aciklama */}
                  <section className="mb-5">
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                      Aciklama
                    </h3>
                    {editing && draft ? (
                      <textarea
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        rows={3}
                        className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                        placeholder="Aciklama..."
                      />
                    ) : task.description ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                        {task.description}
                      </p>
                    ) : (
                      <p className="text-xs italic text-zinc-700">Aciklama yok.</p>
                    )}
                  </section>

                  {/* Analiz */}
                  <section className="mb-5">
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                      Analiz
                    </h3>
                    {editing && draft ? (
                      <textarea
                        value={draft.analysis}
                        onChange={(e) => setDraft({ ...draft, analysis: e.target.value })}
                        rows={8}
                        className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                        placeholder="Teknik analiz..."
                      />
                    ) : task.analysis ? (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-zinc-200">
                        {task.analysis}
                      </pre>
                    ) : (
                      <p className="text-xs italic text-zinc-700">Analiz yok.</p>
                    )}
                  </section>

                  {/* Oncelik (edit modunda) */}
                  {editing && draft && (
                    <section className="mb-5">
                      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                        Oncelik
                      </h3>
                      <div className="flex gap-2">
                        {PRIORITY_BUTTONS.map(({ value, label, color }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDraft({ ...draft, priority: value })}
                            className={clsx(
                              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                              color,
                              draft.priority === value
                                ? "ring-2 ring-offset-1 ring-offset-zinc-900 ring-current"
                                : "opacity-50 hover:opacity-80",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Retry — doing + takili kalmis */}
                  {task.status === "doing" && (
                    <section className="mb-5">
                      <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          {task.agent.status === "idle" ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                              <span>Kuyrukta bekleniyor</span>
                            </>
                          ) : task.agent.status === "error" ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                              <span className="text-red-400">Hata olustu</span>
                            </>
                          ) : (
                            <>
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
                              <span className="text-yellow-300">
                                {{
                                  branching:  "Branch aciliyor...",
                                  running:    "AI yaziyor...",
                                  pushing:    "Push ediliyor...",
                                  pr_opening: "PR olusturuluyor...",
                                  done:       "Tamamlandi",
                                }[task.agent.status] ?? task.agent.status}
                              </span>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={doRetry}
                          disabled={retrying}
                          className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                            <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                          </svg>
                          {retrying ? "Baslatiliyor..." : "Yeniden Dene"}
                        </button>
                      </div>
                    </section>
                  )}

                  {/* Branch / PR */}
                  {(task.branch || task.prUrl) && (
                    <section className="mb-5 flex flex-col gap-3">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                        Baglantilar
                      </h3>
                      {task.branch && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-zinc-600">Branch:</span>
                          <code className="rounded-md bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-blue-300">
                            {task.branch}
                          </code>
                        </div>
                      )}
                      {task.prUrl && (
                        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                          <div className="flex flex-1 items-center gap-2">
                            <a
                              href={task.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-purple-300 hover:text-purple-200 transition"
                            >
                              Pull Request aç {task.prNumber ? `#${task.prNumber}` : ""} ↗
                            </a>
                          </div>
                          {task.status === "done" && (
                            <span className="flex items-center gap-1 rounded-full bg-purple-900/50 px-2.5 py-1 text-[11px] font-semibold text-purple-300">
                              Merged
                            </span>
                          )}
                          {task.agent.status === "error" && task.status !== "done" && (
                            <span className="rounded-full bg-red-900/50 px-2.5 py-1 text-[11px] font-semibold text-red-300">
                              Merge hatasi
                            </span>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </div>
              ) : (
                /* Agent Logu sekmesi */
                <div className="flex h-full flex-col gap-2 p-3">
                  {task.status === "doing" && task.agent.status === "idle" ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-500">
                      <span className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-pulse"
                            style={{ animationDelay: `${i * 200}ms` }}
                          />
                        ))}
                      </span>
                      <span>Kuyrukta bekleniyor...</span>
                    </div>
                  ) : logs.length > 0 ? (
                    <pre
                      ref={logRef}
                      className="flex-1 overflow-auto rounded-xl border border-zinc-800 bg-black p-4 font-mono text-[11px] leading-relaxed text-emerald-400"
                    >
                      {logs.join("\n")}
                    </pre>
                  ) : (
                    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-700">
                      Henuz log yok
                    </div>
                  )}
                  {task.agent.status === "error" && task.agent.error && (
                    <div className="shrink-0 rounded-lg border border-red-800 bg-red-950/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-red-400">
                      <span className="mr-2 font-bold">✖ Hata:</span>
                      <span className="whitespace-pre-wrap">{task.agent.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-950/80 px-5 py-3">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition"
                  >
                    Iptal
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
                  >
                    {saving ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={deleting}
                    className="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-2 text-sm text-red-400 hover:bg-red-900/40 disabled:opacity-50 transition"
                  >
                    {deleting ? "Siliniyor..." : "Sil"}
                  </button>
                  <button
                    type="button"
                    onClick={beginEdit}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
                  >
                    Duzenle
                  </button>
                </>
              )}
            </footer>
          </>
        ) : null}
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        title="Task silinsin mi?"
        description="Bu işlem geri alınamaz. Task kalıcı olarak silinecek."
        confirmLabel="Sil"
        cancelLabel="İptal"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
