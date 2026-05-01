"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import { api } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";
import { StudioCanvas } from "@/components/Studio/StudioCanvas";

type Segment = "instructions" | "studio";

interface ClaudeConfigTabProps {
  projectId: string;
  hasRemote: boolean;
}

export function ClaudeConfigTab({ projectId, hasRemote }: ClaudeConfigTabProps) {
  const cc = useTranslation().claudeConfig;
  const [segment, setSegment] = useState<Segment>("instructions");

  const segments: Array<{ key: Segment; label: string }> = [
    { key: "instructions", label: cc.segmentInstructions },
    { key: "studio",       label: cc.segmentStudio },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex border border-[var(--border)]">
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSegment(s.key)}
            className={clsx(
              "flex-1 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] transition",
              segment === s.key
                ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {segment === "instructions" && (
        <InstructionsSegment projectId={projectId} hasRemote={hasRemote} />
      )}
      {segment === "studio" && (
        <StudioSegmentNew projectId={projectId} />
      )}
    </div>
  );
}

type ViewMode = "split" | "edit" | "preview";
type CommitInfo = { committed: boolean; sha: string | null; warning: string | null } | null;

function InstructionsSegment({ projectId, hasRemote }: { projectId: string; hasRemote: boolean }) {
  const cc = useTranslation().claudeConfig;
  const [loaded, setLoaded] = useState(false);
  const [original, setOriginal] = useState("");
  const [content, setContent] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitInfo, setCommitInfo] = useState<CommitInfo>(null);
  const [pushing, setPushing] = useState(false);
  const [pushFlash, setPushFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setCommitInfo(null);
    setPushFlash(null);
    api.getClaudeInstructions(projectId)
      .then((data) => {
        if (cancelled) return;
        setOriginal(data.content);
        setContent(data.content);
        setExists(data.exists);
        setFilePath(data.path);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const isDirty = useMemo(() => content !== original, [content, original]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setPushFlash(null);
    try {
      const data = await api.putClaudeInstructions(projectId, content);
      setOriginal(data.content);
      setExists(true);
      setCommitInfo({
        committed: data.committed,
        sha: data.commitSha,
        warning: data.commitWarning,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : cc.saveError);
    } finally {
      setSaving(false);
    }
  };

  const push = async () => {
    setPushing(true);
    setPushFlash(null);
    try {
      const data = await api.pushClaudeInstructions(projectId);
      setPushFlash({ ok: true, msg: `${cc.pushed} → ${data.branch}` });
      setTimeout(() => setPushFlash(null), 4000);
    } catch (err) {
      setPushFlash({
        ok: false,
        msg: err instanceof Error ? err.message : cc.pushFailed,
      });
    } finally {
      setPushing(false);
    }
  };

  const warningLabel = (w: string | null): string | null => {
    if (!w) return null;
    if (w === "no_changes") return cc.commitNoChanges;
    if (w === "not_a_git_repo") return cc.commitNotARepo;
    return `${cc.commitFailed}: ${w}`;
  };

  const canPush =
    hasRemote && commitInfo?.committed === true && !pushing;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          {filePath ? (
            <span
              className="truncate font-mono text-[10px] text-[var(--text-faint)]"
              title={filePath}
            >
              {cc.fileLabel}: {filePath}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">
              {cc.instructionsHint}
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-muted)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title={cc.expand}
          >
            ⤢ {cc.expand}
          </button>
        </div>

        {error && (
          <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
            {error}
          </div>
        )}

        {!exists && loaded && !content && (
          <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
            {cc.instructionsEmpty}
          </div>
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={!loaded || saving}
          rows={18}
          spellCheck={false}
          className="w-full resize-y border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition focus:border-[var(--text-secondary)]"
          placeholder={cc.instructionsPlaceholder}
        />

        <ActionRow
          isDirty={isDirty}
          loaded={loaded}
          saving={saving}
          savedFlash={savedFlash}
          commitInfo={commitInfo}
          warningLabel={warningLabel}
          canPush={canPush}
          pushing={pushing}
          pushFlash={pushFlash}
          onRevert={() => setContent(original)}
          onSave={save}
          onPush={push}
        />
      </div>

      {expanded && (
        <ExpandedEditor
          content={content}
          setContent={setContent}
          isDirty={isDirty}
          loaded={loaded}
          saving={saving}
          savedFlash={savedFlash}
          commitInfo={commitInfo}
          warningLabel={warningLabel}
          canPush={canPush}
          pushing={pushing}
          pushFlash={pushFlash}
          filePath={filePath}
          onRevert={() => setContent(original)}
          onSave={save}
          onPush={push}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

interface ActionRowProps {
  isDirty: boolean;
  loaded: boolean;
  saving: boolean;
  savedFlash: boolean;
  commitInfo: CommitInfo;
  warningLabel: (w: string | null) => string | null;
  canPush: boolean;
  pushing: boolean;
  pushFlash: { ok: boolean; msg: string } | null;
  onRevert: () => void;
  onSave: () => void;
  onPush: () => void;
}

function ActionRow(p: ActionRowProps) {
  const cc = useTranslation().claudeConfig;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-[11px] italic text-[var(--text-faint)]">{cc.commitHint}</span>
      <div className="flex flex-wrap items-center gap-2">
        {p.savedFlash && p.commitInfo && (
          p.commitInfo.committed && p.commitInfo.sha ? (
            <span className="font-mono text-[11px] text-[var(--accent-primary)]">
              {cc.committed} {p.commitInfo.sha}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--status-warning)]">
              {p.warningLabel(p.commitInfo.warning) ?? cc.commitSkipped}
            </span>
          )
        )}
        {p.pushFlash && (
          <span
            className={clsx(
              "max-w-[260px] truncate text-[11px]",
              p.pushFlash.ok ? "text-[var(--accent-primary)]" : "text-[var(--status-error)]",
            )}
            title={p.pushFlash.msg}
          >
            {p.pushFlash.msg}
          </span>
        )}
        <button
          type="button"
          onClick={p.onRevert}
          disabled={!p.isDirty || p.saving}
          className="btn-ghost px-3 py-1.5 text-[12px] disabled:opacity-50"
        >
          {cc.revert}
        </button>
        <button
          type="button"
          onClick={p.onPush}
          disabled={!p.canPush}
          className="border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          title={p.canPush ? cc.push : cc.commitHint}
        >
          {p.pushing ? cc.pushing : cc.push}
        </button>
        <button
          type="button"
          onClick={p.onSave}
          disabled={!p.isDirty || p.saving || !p.loaded}
          className="btn-ink px-4 py-1.5 text-[12px] disabled:opacity-50"
        >
          {p.saving ? cc.saving : cc.save}
        </button>
      </div>
    </div>
  );
}

interface ExpandedEditorProps extends ActionRowProps {
  content: string;
  setContent: (v: string) => void;
  filePath: string | null;
  onClose: () => void;
}

function ExpandedEditor(p: ExpandedEditorProps) {
  const cc = useTranslation().claudeConfig;
  const [view, setView] = useState<ViewMode>("split");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const showEditor = view === "split" || view === "edit";
  const showPreview = view === "split" || view === "preview";

  const editorRef  = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const lockRef    = useRef(false);

  const syncScroll = (from: "editor" | "preview") => {
    if (view !== "split") return;
    if (lockRef.current) return;
    const src = from === "editor" ? editorRef.current : previewRef.current;
    const dst = from === "editor" ? previewRef.current : editorRef.current;
    if (!src || !dst) return;
    const srcMax = src.scrollHeight - src.clientHeight;
    const dstMax = dst.scrollHeight - dst.clientHeight;
    if (srcMax <= 0 || dstMax <= 0) return;
    lockRef.current = true;
    dst.scrollTop = (src.scrollTop / srcMax) * dstMax;
    requestAnimationFrame(() => { lockRef.current = false; });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="flex flex-col bg-[var(--bg-base)]"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
      }}
    >
      <header className="grid grid-cols-3 items-center gap-3 border-b border-[var(--border)] px-5 py-3">
        <div className="flex min-w-0 items-center gap-3 justify-self-start">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)]">
            {cc.segmentInstructions}
          </span>
          {p.filePath && (
            <span className="truncate font-mono text-[11px] text-[var(--text-faint)]" title={p.filePath}>
              {p.filePath}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 border border-[var(--border)] justify-self-center">
          {([
            { key: "edit",    label: cc.viewEdit },
            { key: "split",   label: cc.viewSplit },
            { key: "preview", label: cc.viewPreview },
          ] as const).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={clsx(
                "px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] transition",
                view === v.key
                  ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={p.onClose}
          className="border border-[var(--border)] p-2 text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] justify-self-end"
          title={cc.collapse}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {showEditor && (
          <div className={clsx("flex min-h-0 flex-col", showPreview ? "w-1/2 border-r border-[var(--border)]" : "flex-1")}>
            <textarea
              ref={editorRef}
              value={p.content}
              onChange={(e) => p.setContent(e.target.value)}
              onScroll={() => syncScroll("editor")}
              disabled={!p.loaded || p.saving}
              spellCheck={false}
              className="h-full w-full resize-none bg-[var(--bg-base)] px-5 py-4 font-mono text-[13px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none"
              placeholder={cc.instructionsPlaceholder}
            />
          </div>
        )}
        {showPreview && (
          <div
            ref={previewRef}
            onScroll={() => syncScroll("preview")}
            className={clsx("min-h-0 overflow-y-auto px-6 py-5", showEditor ? "w-1/2" : "flex-1")}
          >
            {p.content.trim() ? (
              <article className="prose-claude">
                <ReactMarkdown>{p.content}</ReactMarkdown>
              </article>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] italic text-[var(--text-faint)]">
                {cc.previewEmpty}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3">
        <ActionRow
          isDirty={p.isDirty}
          loaded={p.loaded}
          saving={p.saving}
          savedFlash={p.savedFlash}
          commitInfo={p.commitInfo}
          warningLabel={p.warningLabel}
          canPush={p.canPush}
          pushing={p.pushing}
          pushFlash={p.pushFlash}
          onRevert={p.onRevert}
          onSave={p.onSave}
          onPush={p.onPush}
        />
      </footer>
    </div>,
    document.body,
  );
}

function StudioSegmentNew({ projectId }: { projectId: string }) {
  return (
    <div className="min-h-[500px] flex-1">
      <StudioCanvas projectId={projectId} />
    </div>
  );
}
