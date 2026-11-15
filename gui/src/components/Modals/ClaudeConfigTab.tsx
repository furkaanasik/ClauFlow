"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { StudioCanvas } from "@/components/Studio/StudioCanvas";
import { Button, IconButton } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Textarea } from "@/components/ui/Input";
import { useEscapeLayer, useFocusTrap } from "@/components/ui/overlay";
import {
  IconAlert,
  IconArrowUpRight,
  IconCheck,
  IconClose,
  IconEye,
  IconFile,
  IconFlow,
  IconInfo,
  IconPencil,
  IconRetry,
} from "@/components/ui/icons";

type Segment = "instructions" | "studio";

interface ClaudeConfigTabProps {
  projectId: string;
  hasRemote: boolean;
}

export function ClaudeConfigTab({ projectId, hasRemote }: ClaudeConfigTabProps) {
  const cc = useTranslation().claudeConfig;
  const studioRequest = useBoardStore((s) => s.studioRequest);
  const wantsStudio = !!studioRequest && studioRequest.projectId === projectId;
  const [segment, setSegment] = useState<Segment>(
    wantsStudio ? "studio" : "instructions",
  );
  useEffect(() => {
    if (wantsStudio) setSegment("studio");
  }, [wantsStudio]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b-2 border-line bg-paper px-5 py-2.5">
        <Segmented<Segment>
          label={cc.tabLabel}
          size="sm"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "instructions", label: cc.segmentInstructions, icon: <IconFile size={13} /> },
            { value: "studio", label: cc.segmentStudio, icon: <IconFlow size={13} /> },
          ]}
        />
        <span className="hidden min-w-0 truncate text-[12.5px] text-ink-3 md:inline">
          {segment === "instructions" ? cc.instructionsHint : cc.studioHint}
        </span>
      </div>

      {segment === "instructions" && (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <InstructionsSegment projectId={projectId} hasRemote={hasRemote} />
        </div>
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
        setError(err instanceof Error ? err.message : cc.loadError);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const lineCount = content ? content.split("\n").length : 0;

  return (
    <>
      <div className="mx-auto flex max-w-[980px] flex-col gap-3">
        {error && (
          <div role="alert" className="ui-banner ui-banner--error">
            <IconAlert size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="ui-panel ui-panel--raised overflow-hidden">
          {/* File tab */}
          <header className="flex items-center gap-3 border-b-2 border-line bg-panel px-3.5 py-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border-2 border-line bg-mustard text-[var(--on-mustard)]"
              style={{ boxShadow: "2px 2px 0 var(--shadow-ink)" }}
            >
              <IconFile size={15} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="flex items-center gap-2 text-[14px] font-bold text-ink">
                CLAUDE.md
                {loaded && !exists && (
                  <span className="rounded-pill border-[1.5px] border-line bg-mustard px-1.5 font-mono text-[9.5px] font-bold uppercase leading-[16px] tracking-[0.08em] text-[var(--on-mustard)]">
                    {cc.newFile}
                  </span>
                )}
                {isDirty && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--orange-text)]">
                    <span aria-hidden className="ui-dot !h-2 !w-2" style={{ "--dot": "var(--orange)" } as CSSProperties} />
                    {cc.unsaved}
                  </span>
                )}
              </span>
              {filePath && (
                <span className="truncate font-mono text-[11px] text-ink-3" title={filePath}>
                  {filePath}
                </span>
              )}
            </div>
            <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">{cc.lines(lineCount)}</span>
            <Button size="sm" variant="secondary" icon={<IconArrowUpRight size={13} />} onClick={() => setExpanded(true)}>
              {cc.expand}
            </Button>
          </header>

          {!exists && loaded && !content && (
            <div className="ui-hatch flex items-center gap-2.5 border-b-2 border-dashed border-hair px-4 py-2.5 text-[12.5px] text-ink-2">
              <IconInfo size={14} className="shrink-0 text-[var(--cobalt-text)]" />
              {cc.instructionsEmpty}
            </div>
          )}

          <Textarea
            mono
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={!loaded || saving}
            rows={18}
            spellCheck={false}
            aria-label="CLAUDE.md"
            className="!block !w-full !resize-y !rounded-none !border-0 !bg-sunken !px-4 !py-3.5 !leading-relaxed !shadow-none"
            placeholder={cc.instructionsPlaceholder}
          />

          <div className="border-t-2 border-line bg-panel px-3.5 py-2.5">
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
        </section>
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
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
        <IconInfo size={13} className="shrink-0" />
        {cc.commitHint}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {p.savedFlash && p.commitInfo && (
          p.commitInfo.committed && p.commitInfo.sha ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] font-semibold text-[var(--green-text)]">
              <IconCheck size={13} />
              {cc.committed} {p.commitInfo.sha}
            </span>
          ) : (
            <span className="text-[12px] font-medium text-[var(--orange-text)]">
              {p.warningLabel(p.commitInfo.warning) ?? cc.commitSkipped}
            </span>
          )
        )}
        {p.pushFlash && (
          <span
            className={clsx(
              "max-w-[260px] truncate text-[12px] font-medium",
              p.pushFlash.ok ? "text-[var(--green-text)]" : "text-[var(--red-text)]",
            )}
            title={p.pushFlash.msg}
          >
            {p.pushFlash.msg}
          </span>
        )}
        <Button size="sm" variant="ghost" icon={<IconRetry size={13} />} onClick={p.onRevert} disabled={!p.isDirty || p.saving}>
          {cc.revert}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<IconArrowUpRight size={13} />}
          onClick={p.onPush}
          disabled={!p.canPush}
          loading={p.pushing}
          title={p.canPush ? cc.push : cc.commitHint}
        >
          {p.pushing ? cc.pushing : cc.push}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<IconCheck size={13} />}
          onClick={p.onSave}
          disabled={!p.isDirty || !p.loaded}
          loading={p.saving}
        >
          {p.saving ? cc.saving : cc.save}
        </Button>
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

  // Esc closes the editor only — the project drawer underneath stays open.
  useEscapeLayer(true, p.onClose);
  const frameRef = useRef<HTMLDivElement>(null);
  useFocusTrap(frameRef, true);

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

  // Portalled to <body> with a fixed, full-viewport frame: the drawer it is
  // opened from carries a transform and would otherwise clip it.
  return createPortal(
    <div
      ref={frameRef}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={`CLAUDE.md · ${cc.segmentInstructions}`}
      className="cc-full flex flex-col bg-paper"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
      }}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b-2 border-line bg-panel px-5 py-3">
        <div className="flex min-w-0 items-center gap-3 justify-self-start">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border-2 border-line bg-mustard text-[var(--on-mustard)]"
            style={{ boxShadow: "2px 2px 0 var(--shadow-ink)" }}
          >
            <IconFile size={16} />
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="t-display text-[18px] text-ink">CLAUDE.md</span>
            {p.filePath && (
              <span className="truncate font-mono text-[11px] text-ink-3" title={p.filePath}>
                {p.filePath}
              </span>
            )}
          </div>
          {p.isDirty && (
            <span className="ml-1 inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-[var(--orange-text)]">
              <span aria-hidden className="ui-dot ui-dot--live !h-2 !w-2" style={{ "--dot": "var(--orange)" } as CSSProperties} />
              {cc.unsaved}
            </span>
          )}
        </div>

        <Segmented<ViewMode>
          label={cc.viewLabel}
          size="sm"
          value={view}
          onChange={setView}
          className="justify-self-center"
          options={[
            { value: "edit", label: cc.viewEdit, icon: <IconPencil size={13} /> },
            { value: "split", label: cc.viewSplit },
            { value: "preview", label: cc.viewPreview, icon: <IconEye size={13} /> },
          ]}
        />

        <IconButton label={cc.collapse} size="sm" onClick={p.onClose} className="justify-self-end">
          <IconClose size={14} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {showEditor && (
          <div className={clsx("ui-panel ui-panel--raised flex min-h-0 flex-col overflow-hidden", showPreview ? "w-1/2" : "flex-1")}>
            <div className="flex items-center gap-2 border-b-2 border-line bg-panel px-3.5 py-2">
              <IconPencil size={13} className="text-ink-3" />
              <span className="t-label !text-[10px]">{cc.paneSource}</span>
            </div>
            <textarea
              ref={editorRef}
              value={p.content}
              onChange={(e) => p.setContent(e.target.value)}
              onScroll={() => syncScroll("editor")}
              disabled={!p.loaded || p.saving}
              spellCheck={false}
              data-autofocus
              aria-label="CLAUDE.md"
              className="h-full w-full flex-1 resize-none bg-sunken px-5 py-4 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-[inset_0_0_0_2.5px_var(--focus)]"
              placeholder={cc.instructionsPlaceholder}
            />
          </div>
        )}
        {showPreview && (
          <div className={clsx("ui-panel ui-panel--raised flex min-h-0 flex-col overflow-hidden", showEditor ? "w-1/2" : "flex-1")}>
            <div className="flex items-center gap-2 border-b-2 border-line bg-panel px-3.5 py-2">
              <IconEye size={13} className="text-ink-3" />
              <span className="t-label !text-[10px]">{cc.panePreview}</span>
            </div>
            <div
              ref={previewRef}
              onScroll={() => syncScroll("preview")}
              className="min-h-0 flex-1 overflow-y-auto bg-panel px-7 py-6"
            >
              {p.content.trim() ? (
                <article className="prose-claude">
                  <ReactMarkdown>{p.content}</ReactMarkdown>
                </article>
              ) : (
                <div className="ui-hatch flex h-full items-center justify-center rounded-[10px] border-2 border-dashed border-hair text-[13px] text-ink-3">
                  {cc.previewEmpty}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="border-t-2 border-line bg-panel px-5 py-3">
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
  const studioRequest = useBoardStore((s) => s.studioRequest);
  const taskId =
    studioRequest && studioRequest.projectId === projectId
      ? studioRequest.taskId
      : undefined;
  // Fixed minimum height: React Flow needs a parent with a definite height.
  return (
    <div className="flex min-h-[560px] flex-1 flex-col">
      <StudioCanvas projectId={projectId} taskId={taskId} />
    </div>
  );
}
