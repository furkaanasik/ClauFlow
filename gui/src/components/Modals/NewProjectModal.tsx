"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { slugify } from "@/lib/slug";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,10}[a-z0-9]$|^[a-z0-9]{2}$/;

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--cf-card)", border: "1px solid var(--cf-border)",
  borderRadius: 6, padding: "7px 10px", fontSize: 13, color: "var(--cf-text)",
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

const monoInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "monospace",
};

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const addProject    = useBoardStore((s) => s.addProject);
  const selectProject = useBoardStore((s) => s.selectProject);
  const t             = useTranslation();

  const [name,          setName]          = useState("");
  const [slug,          setSlug]          = useState("");
  const [slugEdited,    setSlugEdited]    = useState(false);
  const [slugError,     setSlugError]     = useState<string | null>(null);
  const [repoPath,      setRepoPath]      = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [remote,        setRemote]        = useState("");
  const [createGithub,  setCreateGithub]  = useState(false);
  const [repoName,      setRepoName]      = useState("");
  const [isPrivate,     setIsPrivate]     = useState(true);
  const [aiPrompt,      setAiPrompt]      = useState("");
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [githubWarning, setGithubWarning] = useState<string | null>(null);

  const reset = () => {
    setName(""); setSlug(""); setSlugEdited(false); setSlugError(null);
    setRepoPath(""); setDefaultBranch("main"); setRemote("");
    setCreateGithub(false); setRepoName(""); setIsPrivate(true);
    setAiPrompt(""); setError(null); setGithubWarning(null);
  };

  const handleClose = () => { if (submitting) return; reset(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoPath.trim()) { setError(t.newProject.errorRequired); return; }
    const finalSlug = slug.trim() || slugify(name.trim());
    if (!SLUG_REGEX.test(finalSlug)) { setSlugError(t.newProject.slugError); return; }
    setSlugError(null); setSubmitting(true); setError(null); setGithubWarning(null);
    try {
      const trimmedPrompt = aiPrompt.trim();
      const { project, githubError } = await api.createProject({
        name: name.trim(),
        slug: finalSlug,
        repoPath: repoPath.trim(),
        defaultBranch: defaultBranch.trim() || "main",
        remote: createGithub ? undefined : (remote.trim() || null),
        ...(createGithub && { createGithubRepo: true, repoName: repoName.trim() || undefined, isPrivate }),
        ...(trimmedPrompt && { aiPrompt: trimmedPrompt }),
      });
      addProject(project);
      selectProject(project.id);
      if (githubError) { setGithubWarning(githubError); setSubmitting(false); return; }
      reset(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={t.newProject.modalTitle} size="lg">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Name */}
        <Field label={t.newProject.nameLabel} required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => { if (!slugEdited && e.target.value.trim()) setSlug(slugify(e.target.value.trim())); }}
            style={inputStyle}
            placeholder={t.newProject.namePlaceholder}
            autoFocus
            disabled={submitting}
          />
        </Field>

        {/* Slug */}
        <Field label={t.newProject.slugLabel} hint={t.newProject.slugHint}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 12);
                setSlug(v); setSlugEdited(true); setSlugError(null);
              }}
              onBlur={() => { if (slug && !SLUG_REGEX.test(slug)) setSlugError(t.newProject.slugError); }}
              style={{ ...monoInputStyle, paddingRight: 44, borderColor: slugError ? "#ef4444" : undefined }}
              placeholder={t.newProject.slugPlaceholder}
              disabled={submitting}
              maxLength={12}
            />
            <span style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              fontFamily: "monospace", fontSize: 10, color: "var(--cf-muted)", pointerEvents: "none",
            }}>
              {String(slug.length).padStart(2, "0")}/12
            </span>
          </div>
          {slugError && <span style={{ fontSize: 11, color: "#ef4444" }}>{slugError}</span>}
        </Field>

        {/* Repo path */}
        <Field label={t.newProject.repoPathLabel} required>
          <input
            type="text"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            style={monoInputStyle}
            placeholder="/home/user/projects/my-repo"
            disabled={submitting}
          />
        </Field>

        {/* AI Prompt */}
        <Field label={t.newProject.aiPromptLabel}>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "none", lineHeight: 1.5 }}
            placeholder={t.newProject.aiPromptPlaceholder}
            disabled={submitting}
          />
        </Field>

        {/* Default branch */}
        <Field label={t.newProject.defaultBranchLabel}>
          <input
            type="text"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            style={monoInputStyle}
            placeholder="main"
            disabled={submitting}
          />
        </Field>

        {/* GitHub repo creation toggle */}
        <label style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 7, cursor: "pointer",
          background: createGithub ? "rgba(99,102,241,0.08)" : "var(--cf-card)",
          border: `1px solid ${createGithub ? "rgba(99,102,241,0.4)" : "var(--cf-border)"}`,
          transition: "all 0.12s",
        }}>
          <span style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: createGithub ? "#6366f1" : "transparent",
            border: `1px solid ${createGithub ? "#6366f1" : "var(--cf-border)"}`,
          }}>
            {createGithub && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="2 6 5 9 10 3" />
              </svg>
            )}
          </span>
          <input type="checkbox" checked={createGithub} onChange={(e) => setCreateGithub(e.target.checked)} disabled={submitting} style={{ display: "none" }} />
          <div>
            <div style={{ fontSize: 13, color: "var(--cf-text)" }}>{t.newProject.createGithubLabel}</div>
            <div style={{ fontSize: 11, color: "var(--cf-muted)" }}>Uses GitHub CLI device flow</div>
          </div>
        </label>

        {createGithub && (
          <>
            <Field label={t.newProject.repoNameLabel}>
              <input
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                style={monoInputStyle}
                placeholder={name.trim() || t.newProject.namePlaceholder}
                disabled={submitting}
              />
            </Field>

            <Field label={t.newProject.visibilityLabel}>
              <div style={{ display: "flex", gap: 1, background: "var(--cf-border)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--cf-border)" }}>
                {([true, false] as const).map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setIsPrivate(val)}
                    disabled={submitting}
                    style={{
                      flex: 1, padding: "6px 0", border: "none", cursor: "pointer",
                      background: isPrivate === val ? "var(--cf-card)" : "transparent",
                      color: isPrivate === val ? "var(--cf-text)" : "var(--cf-muted)",
                      fontSize: 12, fontWeight: 500,
                    }}
                  >
                    {val ? t.newProject.visibilityPrivate : t.newProject.visibilityPublic}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}

        {!createGithub && (
          <Field label={t.newProject.remoteLabel}>
            <input
              type="text"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              style={monoInputStyle}
              placeholder="git@github.com:org/repo.git"
              disabled={submitting}
            />
          </Field>
        )}

        {error && (
          <div style={{
            padding: "8px 12px", borderRadius: 5,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
            color: "#ef4444", fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {githubWarning && (
          <div style={{
            padding: "8px 12px", borderRadius: 5,
            background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
            color: "#f59e0b", fontSize: 12,
          }}>
            {t.newProject.githubWarningPrefix}{githubWarning}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, paddingTop: 4, borderTop: "1px solid var(--cf-border)" }}>
          {githubWarning ? (
            <button
              type="button"
              onClick={() => { reset(); onClose(); }}
              style={{
                marginLeft: "auto", padding: "7px 20px", fontSize: 12, fontWeight: 600,
                background: "#6366f1", border: "1px solid transparent",
                borderRadius: 6, color: "#fff", cursor: "pointer",
              }}
            >
              {t.newProject.close}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                style={{
                  padding: "7px 18px", fontSize: 12, fontWeight: 500,
                  background: "transparent", border: "1px solid var(--cf-border)",
                  borderRadius: 6, color: "var(--cf-muted)", cursor: "pointer",
                }}
              >
                {t.newProject.cancel}
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: "7px 20px", fontSize: 12, fontWeight: 600,
                  background: submitting ? "rgba(99,102,241,0.5)" : "#6366f1",
                  border: "1px solid transparent",
                  borderRadius: 6, color: "#fff",
                  cursor: submitting ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {submitting ? t.newProject.submitting : t.newProject.submit}
                {!submitting && <span aria-hidden>→</span>}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--cf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}{required && <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>}
        </span>
        {hint && <span style={{ fontSize: 11, color: "var(--cf-muted)", fontStyle: "italic" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
