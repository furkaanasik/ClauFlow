"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import { api, type AvailablePlugin, type ClaudeAgent, type ClaudeMarketplace, type InstalledPlugin } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useBoardStore } from "@/store/boardStore";

type Segment = "instructions" | "agents" | "skills" | "studio";

interface ClaudeConfigTabProps {
  projectId: string;
  hasRemote: boolean;
}

export function ClaudeConfigTab({ projectId, hasRemote }: ClaudeConfigTabProps) {
  const cc = useTranslation().claudeConfig;
  const [segment, setSegment] = useState<Segment>("instructions");

  const segments: Array<{ key: Segment; label: string }> = [
    { key: "instructions", label: cc.segmentInstructions },
    { key: "agents",       label: cc.segmentAgents },
    { key: "skills",       label: cc.segmentSkills },
    { key: "studio",       label: cc.segmentStudio },
  ];

  return (
    <div className="flex flex-col gap-4">
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
      {segment === "agents" && (
        <AgentsSegment projectId={projectId} hasRemote={hasRemote} />
      )}
      {segment === "skills" && (
        <SkillsSegment projectId={projectId} />
      )}
      {segment === "studio" && (
        <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
          {cc.notImplemented}
        </div>
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

type AgentsView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; slug: string };

function AgentsSegment({ projectId, hasRemote }: { projectId: string; hasRemote: boolean }) {
  const t = useTranslation();
  const ca = t.claudeAgents;
  const cc = t.claudeConfig;
  const [view, setView] = useState<AgentsView>({ kind: "list" });
  const [agents, setAgents] = useState<ClaudeAgent[] | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushFlash, setPushFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  const reload = async () => {
    setLoadError(null);
    try {
      const data = await api.listClaudeAgents(projectId);
      setAgents(data.agents);
      setDir(data.dir);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : ca.loadError);
    }
  };

  useEffect(() => {
    void reload();
  }, [projectId]);

  const push = async () => {
    setPushing(true);
    setPushFlash(null);
    try {
      const data = await api.pushClaude(projectId);
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

  if (view.kind === "create") {
    return (
      <AgentForm
        mode="create"
        projectId={projectId}
        existingSlugs={(agents ?? []).map((a) => a.slug)}
        onCancel={() => setView({ kind: "list" })}
        onSaved={async () => {
          await reload();
          setView({ kind: "list" });
        }}
      />
    );
  }

  if (view.kind === "edit") {
    return (
      <AgentForm
        mode="edit"
        projectId={projectId}
        slug={view.slug}
        existingSlugs={(agents ?? []).map((a) => a.slug)}
        onCancel={() => setView({ kind: "list" })}
        onSaved={async () => {
          await reload();
          setView({ kind: "list" });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        {dir ? (
          <span className="truncate font-mono text-[10px] text-[var(--text-faint)]" title={dir}>
            {ca.dirHint}: {dir}
          </span>
        ) : <span />}
        <div className="flex items-center gap-2">
          {pushFlash && (
            <span
              className={clsx(
                "max-w-[220px] truncate text-[11px]",
                pushFlash.ok ? "text-[var(--accent-primary)]" : "text-[var(--status-error)]",
              )}
              title={pushFlash.msg}
            >
              {pushFlash.msg}
            </span>
          )}
          <button
            type="button"
            onClick={push}
            disabled={!hasRemote || pushing}
            className="border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            title={hasRemote ? cc.push : cc.commitHint}
          >
            {pushing ? cc.pushing : cc.push}
          </button>
          <button
            type="button"
            onClick={() => setView({ kind: "create" })}
            className="btn-ink whitespace-nowrap px-3 py-1.5 text-[11px]"
          >
            + {ca.newAgent}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
          {loadError}
        </div>
      )}

      {agents === null ? (
        <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">…</div>
      ) : agents.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
          {ca.emptyState}
        </div>
      ) : (
        <ul className="flex flex-col border border-[var(--border)]">
          {agents.map((a) => (
            <li
              key={a.slug}
              className="group flex cursor-pointer items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 transition last:border-b-0 hover:bg-[var(--bg-surface)]"
              onClick={() => setView({ kind: "edit", slug: a.slug })}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                    {a.name || ca.untitled}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">
                    {a.slug}.md
                  </span>
                </div>
                <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">
                  {a.description || ca.noDescription}
                </div>
              </div>
              <div className="shrink-0 self-center font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                {a.model || ca.noModel}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface AgentFormProps {
  mode: "create" | "edit";
  projectId: string;
  slug?: string;
  existingSlugs: string[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

const MODEL_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "inherit",                       label: "inherit" },
  { value: "opus",                          label: "opus (alias)" },
  { value: "sonnet",                        label: "sonnet (alias)" },
  { value: "haiku",                         label: "haiku (alias)" },
  { value: "claude-opus-4-7",               label: "claude-opus-4-7" },
  { value: "claude-sonnet-4-6",             label: "claude-sonnet-4-6" },
  { value: "claude-haiku-4-5-20251001",     label: "claude-haiku-4-5-20251001" },
];

function AgentForm(p: AgentFormProps) {
  const t = useTranslation();
  const ca = t.claudeAgents;
  const isEdit = p.mode === "edit";

  const [loading, setLoading] = useState(isEdit);
  const [original, setOriginal] = useState<ClaudeAgent | null>(null);
  const [slug, setSlug] = useState(p.slug ?? "");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [commitInfo, setCommitInfo] = useState<CommitInfo>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);

  const isPresetModel = MODEL_PRESETS.some((m) => m.value === model);
  const modelSelectValue = model === "" ? "" : isPresetModel ? model : "__custom__";

  useEffect(() => {
    if (!isEdit || !p.slug) return;
    let cancelled = false;
    setLoading(true);
    api.getClaudeAgent(p.projectId, p.slug)
      .then((a) => {
        if (cancelled) return;
        setOriginal(a);
        setSlug(a.slug);
        setName(a.name);
        setModel(a.model ?? "");
        setDescription(a.description ?? "");
        setBody(a.body);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : ca.loadError);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isEdit, p.projectId, p.slug]);

  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const slugDuplicate =
    !isEdit && p.existingSlugs.includes(slug);

  const isDirty = isEdit
    ? (original
        ? name !== original.name ||
          model !== (original.model ?? "") ||
          description !== (original.description ?? "") ||
          body !== original.body
        : false)
    : slug.length > 0 || name.length > 0 || description.length > 0 || body.length > 0;

  const canSave =
    !saving &&
    !loading &&
    slugValid &&
    !slugDuplicate &&
    (isEdit ? isDirty : true);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: name || slug,
        model: model || undefined,
        description: description || undefined,
        body,
      };
      let result;
      if (isEdit) {
        result = await api.updateClaudeAgent(p.projectId, slug, payload);
      } else {
        result = await api.createClaudeAgent(p.projectId, { slug, ...payload });
      }
      setCommitInfo({
        committed: result.committed,
        sha: result.commitSha,
        warning: result.commitWarning,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      await p.onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : ca.saveError;
      if (msg.includes("agent_already_exists")) {
        setError(ca.duplicate);
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!isEdit) return;
    setConfirmDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await api.deleteClaudeAgent(p.projectId, slug);
      await p.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : ca.deleteError);
      setDeleting(false);
    }
  };

  const warningLabel = (w: string | null) => {
    if (!w) return null;
    if (w === "no_changes") return null;
    if (w === "not_a_git_repo") return null;
    return w;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={p.onCancel}
          className="text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        >
          {ca.backToList}
        </button>
        {savedFlash && commitInfo?.committed && commitInfo.sha && (
          <span className="font-mono text-[11px] text-[var(--accent-primary)]">
            commit {commitInfo.sha}
          </span>
        )}
        {savedFlash && commitInfo && !commitInfo.committed && warningLabel(commitInfo.warning) && (
          <span className="text-[11px] text-[var(--status-warning)]">
            {warningLabel(commitInfo.warning)}
          </span>
        )}
      </div>

      {error && (
        <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.slugLabel}</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={isEdit || loading || saving}
            placeholder={ca.slugPlaceholder}
            spellCheck={false}
            className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-60"
          />
          {!isEdit && slug && !slugValid && (
            <span className="text-[11px] text-[var(--status-error)]">{ca.slugError}</span>
          )}
          {!isEdit && slugValid && slugDuplicate && (
            <span className="text-[11px] text-[var(--status-error)]">{ca.duplicate}</span>
          )}
          {!isEdit && !slug && (
            <span className="text-[11px] text-[var(--text-faint)]">{ca.slugHint}</span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.nameLabel}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading || saving}
            placeholder={ca.namePlaceholder}
            className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.modelLabel}</span>
        <div className="flex gap-2">
          <select
            value={modelSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") setModel("");
              else if (v === "__custom__") setModel(isPresetModel ? "" : model || " ");
              else setModel(v);
            }}
            disabled={loading || saving}
            className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
          >
            <option value="">{ca.modelInherit}</option>
            {MODEL_PRESETS.filter((m) => m.value !== "inherit").map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
            <option value="__custom__">{ca.modelCustom}</option>
          </select>
          {modelSelectValue === "__custom__" && (
            <input
              value={model.trim()}
              onChange={(e) => setModel(e.target.value)}
              disabled={loading || saving}
              placeholder={ca.modelCustomPlaceholder}
              spellCheck={false}
              autoFocus
              className="flex-1 border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
            />
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.descriptionLabel}</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading || saving}
          placeholder={ca.descriptionPlaceholder}
          className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)]"
        />
      </label>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{ca.bodyLabel}</span>
          <button
            type="button"
            onClick={() => setBodyExpanded(true)}
            disabled={loading || saving}
            className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-muted)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            title={ca.bodyExpand}
          >
            ⤢ {ca.bodyExpand}
          </button>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={loading || saving}
          rows={16}
          spellCheck={false}
          placeholder={ca.bodyPlaceholder}
          className="w-full resize-y border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition focus:border-[var(--text-secondary)]"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {isEdit && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting || saving}
              className="border border-[var(--status-error)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--status-error)] transition hover:bg-[var(--status-error-ink)] disabled:opacity-40"
            >
              {deleting ? ca.deleting : ca.delete}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={p.onCancel}
            disabled={saving}
            className="btn-ghost px-3 py-1.5 text-[12px] disabled:opacity-50"
          >
            {ca.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="btn-ink px-4 py-1.5 text-[12px] disabled:opacity-50"
          >
            {saving
              ? (isEdit ? ca.saving : ca.creating)
              : (isEdit ? ca.save : ca.create)}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={ca.confirmDeleteTitle}
        description={ca.confirmDeleteDescription}
        confirmLabel={ca.delete}
        cancelLabel={ca.cancel}
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      {bodyExpanded && (
        <MarkdownFullscreen
          title={`${ca.bodyLabel} — ${slug || ca.untitled}`}
          content={body}
          setContent={setBody}
          placeholder={ca.bodyPlaceholder}
          disabled={loading || saving}
          onClose={() => setBodyExpanded(false)}
        />
      )}
    </div>
  );
}

interface MarkdownFullscreenProps {
  title: string;
  content: string;
  setContent: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onClose: () => void;
}

function MarkdownFullscreen(p: MarkdownFullscreenProps) {
  const cc = useTranslation().claudeConfig;
  const [view, setView] = useState<ViewMode>("split");
  const editorRef  = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const lockRef    = useRef(false);

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
      style={{ position: "fixed", inset: 0, zIndex: 9999 }}
    >
      <header className="grid grid-cols-3 items-center gap-3 border-b border-[var(--border)] px-5 py-3">
        <div className="flex min-w-0 items-center gap-3 justify-self-start">
          <span className="truncate text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)]" title={p.title}>
            {p.title}
          </span>
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
              disabled={p.disabled}
              spellCheck={false}
              className="h-full w-full resize-none bg-[var(--bg-base)] px-5 py-4 font-mono text-[13px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none"
              placeholder={p.placeholder}
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
    </div>,
    document.body,
  );
}

// ─── Skills Segment ───────────────────────────────────────────────────────────

type SkillsTab = "installed" | "registry" | "marketplaces";
type PluginScope = "local" | "project" | "user";

const SCOPE_COLORS: Record<PluginScope, string> = {
  local:   "bg-blue-500/15 text-blue-400",
  project: "bg-purple-500/15 text-purple-400",
  user:    "bg-emerald-500/15 text-emerald-400",
};

function SkillsSegment({ projectId }: { projectId: string }) {
  const t = useTranslation();
  const cs = t.claudeSkills;
  const [tab, setTab] = useState<SkillsTab>("installed");

  // Installed
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  // Registry
  const [registry, setRegistry] = useState<AvailablePlugin[] | null>(null);
  // Marketplaces
  const [marketplaces, setMarketplaces] = useState<ClaudeMarketplace[] | null>(null);
  // Install scope per pluginId
  const [scopeMap, setScopeMap] = useState<Record<string, PluginScope>>({});

  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null); // pluginId
  // Marketplace add form
  const [mpSource, setMpSource] = useState("");
  const [mpAdding, setMpAdding] = useState(false);

  const skillProgress = useBoardStore((s) => s.skillProgress);
  const clearSkillProgress = useBoardStore((s) => s.clearSkillProgress);

  const getProgress = (pluginId: string) => skillProgress[`${projectId}:${pluginId}`];

  // ── Loaders ─────────────────────────────────────────────────────────────────

  const loadInstalled = async () => {
    setLoadError(null);
    try {
      const data = await api.listInstalledSkills(projectId);
      setInstalled(data.installed);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : cs.loadError);
    }
  };

  const loadRegistry = async (force = false) => {
    if (registry !== null && !force) return;
    setLoadError(null);
    try {
      const data = await api.listSkillRegistry(projectId);
      setRegistry(data.available);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : cs.loadError);
    }
  };

  const loadMarketplaces = async () => {
    setLoadError(null);
    try {
      const data = await api.listMarketplaces(projectId);
      setMarketplaces(data.marketplaces);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : cs.marketplaceLoadError);
    }
  };

  useEffect(() => { void loadInstalled(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === "registry")     void loadRegistry();
    if (tab === "marketplaces") void loadMarketplaces();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh installed when WS reports done
  useEffect(() => {
    const done = Object.entries(skillProgress)
      .filter(([k]) => k.startsWith(`${projectId}:`))
      .some(([, v]) => v.status === "done");
    if (done) void loadInstalled();
  }, [skillProgress, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleInstall = async (pluginId: string) => {
    setActionError(null);
    const scope = scopeMap[pluginId] ?? "local";
    try {
      await api.installSkill(projectId, pluginId, scope);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.installError);
    }
  };

  const handleToggleEnable = async (plugin: InstalledPlugin) => {
    setActionError(null);
    try {
      if (plugin.enabled) {
        await api.disableSkill(projectId, plugin.id);
      } else {
        await api.enableSkill(projectId, plugin.id);
      }
      await loadInstalled();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : (plugin.enabled ? cs.disableError : cs.enableError),
      );
    }
  };

  const handleUninstall = async (pluginId: string) => {
    setConfirmUninstall(null);
    setActionError(null);
    try {
      await api.uninstallSkill(projectId, pluginId);
      clearSkillProgress(projectId, pluginId);
      await loadInstalled();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.uninstallError);
    }
  };

  const handleAddMarketplace = async () => {
    if (!mpSource.trim()) return;
    setMpAdding(true);
    setActionError(null);
    try {
      // Determine source shape: GitHub shorthand "owner/repo", URL "https://...", or path
      const raw = mpSource.trim();
      let sourceObj: ClaudeMarketplace["source"];
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        sourceObj = { source: "url", url: raw };
      } else if (/^[\w.-]+\/[\w.-]/.test(raw)) {
        sourceObj = { source: "github", repo: raw };
      } else {
        sourceObj = { source: "path", path: raw };
      }
      await api.addMarketplace(projectId, sourceObj);
      setMpSource("");
      await loadMarketplaces();
      // Refresh registry with the new marketplace source
      void loadRegistry(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.marketplaceAddError);
    } finally {
      setMpAdding(false);
    }
  };

  const handleRemoveMarketplace = async (name: string) => {
    setActionError(null);
    try {
      await api.removeMarketplace(projectId, name);
      await loadMarketplaces();
      void loadRegistry(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.marketplaceRemoveError);
    }
  };

  const installedIds = new Set((installed ?? []).map((p) => p.id));

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Tab bar */}
      <div className="flex border border-[var(--border)]">
        {(
          [
            { key: "installed"    as SkillsTab, label: cs.tabInstalled },
            { key: "registry"     as SkillsTab, label: cs.tabRegistry },
            { key: "marketplaces" as SkillsTab, label: cs.tabMarketplaces },
          ] as const
        ).map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={clsx(
              "flex-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] transition",
              tab === tb.key
                ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {tb.label}
            {tb.key === "installed" && (installed?.length ?? 0) > 0 && (
              <span className="ml-1.5 font-mono text-[10px] opacity-70">({installed!.length})</span>
            )}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
          {loadError}
        </div>
      )}
      {actionError && (
        <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
          {actionError}
        </div>
      )}

      {/* ── Installed tab ── */}
      {tab === "installed" && (
        <>
          {installed === null ? (
            <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">…</div>
          ) : installed.length === 0 ? (
            <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
              {cs.emptyInstalled}
            </div>
          ) : (
            <ul className="flex flex-col border border-[var(--border)]">
              {installed.map((plugin) => {
                const prog = getProgress(plugin.id);
                const isWorking = prog?.status === "running";
                const scopeLabel =
                  plugin.scope === "local"   ? cs.scopeLocal   :
                  plugin.scope === "project" ? cs.scopeProject :
                  cs.scopeUser;
                return (
                  <li
                    key={plugin.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1" title={plugin.installPath}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                          {plugin.id}
                        </span>
                        {plugin.version && (
                          <span className="font-mono text-[10px] text-[var(--text-faint)]">
                            v{plugin.version}
                          </span>
                        )}
                        <span
                          className={clsx(
                            "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]",
                            SCOPE_COLORS[plugin.scope],
                          )}
                        >
                          {scopeLabel}
                        </span>
                      </div>
                      {plugin.projectPath && (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-faint)]">
                          {plugin.projectPath}
                        </div>
                      )}
                      {prog && (
                        <div
                          className={clsx(
                            "mt-0.5 text-[11px]",
                            prog.status === "error" ? "text-[var(--status-error)]" : "text-[var(--text-muted)]",
                          )}
                        >
                          {prog.status === "running" ? cs.running :
                           prog.status === "done"    ? cs.done    :
                           prog.message ?? cs.error}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={clsx(
                          "text-[10px] uppercase tracking-[0.08em]",
                          plugin.enabled ? "text-[var(--accent-primary)]" : "text-[var(--text-faint)]",
                        )}
                      >
                        {plugin.enabled ? cs.enabled : cs.disabled}
                      </span>
                      <button
                        type="button"
                        disabled={isWorking}
                        onClick={() => void handleToggleEnable(plugin)}
                        className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                      >
                        {plugin.enabled ? cs.disable : cs.enable}
                      </button>
                      <button
                        type="button"
                        disabled={isWorking}
                        onClick={() => setConfirmUninstall(plugin.id)}
                        className="border border-[var(--status-error)] bg-transparent px-2 py-1 text-[11px] text-[var(--status-error)] transition hover:bg-[var(--status-error-ink)] disabled:opacity-40"
                      >
                        {cs.uninstall}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ── Registry tab ── */}
      {tab === "registry" && (
        <>
          {registry === null ? (
            <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">…</div>
          ) : registry.length === 0 ? (
            <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
              {cs.emptyRegistry}
            </div>
          ) : (
            <ul className="flex flex-col border border-[var(--border)]">
              {registry.map((avail) => {
                const alreadyInstalled = installedIds.has(avail.pluginId);
                const prog = getProgress(avail.pluginId);
                const isWorking = prog?.status === "running";
                const externalUrl = avail.homepage
                  ?? avail.source.url
                  ?? (avail.source.repo ? `https://github.com/${avail.source.repo}` : undefined);
                const scope = scopeMap[avail.pluginId] ?? "local";
                return (
                  <li
                    key={avail.pluginId}
                    className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                          {avail.name}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--text-faint)]">
                          {avail.pluginId}
                        </span>
                        {avail.marketplaceName && (
                          <span className="text-[10px] text-[var(--text-faint)]">
                            {avail.marketplaceName}
                          </span>
                        )}
                      </div>
                      {avail.description && (
                        <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                          {avail.description}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--text-faint)]">
                        {avail.author && <span>{cs.author}: {avail.author}</span>}
                        {avail.installCount !== undefined && (
                          <span>{cs.installCount.replace("{n}", String(avail.installCount))}</span>
                        )}
                      </div>
                      {prog && (
                        <div
                          className={clsx(
                            "mt-0.5 text-[11px]",
                            prog.status === "error" ? "text-[var(--status-error)]" : "text-[var(--text-muted)]",
                          )}
                        >
                          {prog.status === "running" ? cs.running :
                           prog.status === "done"    ? cs.installed :
                           prog.message ?? cs.error}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 self-center">
                      {/* External link */}
                      {externalUrl && (
                        <a
                          href={externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={cs.viewSkill}
                          className="flex items-center border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[var(--text-muted)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" />
                            <path d="M8 1h3v3" />
                            <path d="M11 1L5.5 6.5" />
                          </svg>
                        </a>
                      )}
                      {/* Scope selector + Install */}
                      {alreadyInstalled ? (
                        <span className="text-[11px] text-[var(--accent-primary)]">
                          ✓ {cs.installed}
                        </span>
                      ) : (
                        <>
                          <select
                            value={scope}
                            onChange={(e) =>
                              setScopeMap((prev) => ({ ...prev, [avail.pluginId]: e.target.value as PluginScope }))
                            }
                            disabled={isWorking}
                            title={cs.chooseScope}
                            className="border border-[var(--border)] bg-[var(--bg-surface)] px-1.5 py-1 font-mono text-[10px] text-[var(--text-secondary)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-40"
                          >
                            <option value="local">{cs.scopeLocal}</option>
                            <option value="project">{cs.scopeProject}</option>
                            <option value="user">{cs.scopeUser}</option>
                          </select>
                          <button
                            type="button"
                            disabled={isWorking}
                            onClick={() => void handleInstall(avail.pluginId)}
                            className="btn-ink px-3 py-1.5 text-[11px] disabled:opacity-50"
                          >
                            {isWorking ? cs.installing : cs.install}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ── Marketplaces tab ── */}
      {tab === "marketplaces" && (
        <div className="flex flex-col gap-3">
          {/* Add form */}
          <div className="flex items-center gap-2">
            <input
              value={mpSource}
              onChange={(e) => setMpSource(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAddMarketplace(); }}
              disabled={mpAdding}
              placeholder={cs.marketplaceSourcePlaceholder}
              spellCheck={false}
              className="flex-1 border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void handleAddMarketplace()}
              disabled={mpAdding || !mpSource.trim()}
              className="btn-ink whitespace-nowrap px-3 py-1.5 text-[11px] disabled:opacity-50"
            >
              {mpAdding ? "…" : cs.addMarketplace}
            </button>
          </div>

          {/* List */}
          {marketplaces === null ? (
            <div className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">…</div>
          ) : marketplaces.length === 0 ? (
            <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
              {cs.noMarketplaces}
            </div>
          ) : (
            <ul className="flex flex-col border border-[var(--border)]">
              {marketplaces.map((mp) => {
                const src = mp.source.repo ?? mp.source.url ?? mp.source.path ?? mp.source.source;
                return (
                  <li
                    key={mp.name}
                    className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                        {mp.name}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-faint)]">
                        {src}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveMarketplace(mp.name)}
                      className="shrink-0 border border-[var(--status-error)] bg-transparent px-2 py-1 text-[11px] text-[var(--status-error)] transition hover:bg-[var(--status-error-ink)]"
                    >
                      {cs.removeMarketplace}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmUninstall !== null}
        title={cs.confirmUninstallTitle}
        description={cs.confirmUninstallDescription}
        confirmLabel={cs.uninstall}
        cancelLabel={cs.cancel}
        variant="danger"
        onConfirm={() => {
          if (confirmUninstall) void handleUninstall(confirmUninstall);
        }}
        onCancel={() => setConfirmUninstall(null)}
      />
    </div>
  );
}
