"use client";

import { useId, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { IconAlert, IconArrowUpRight, IconBranch, IconFolder, IconGithub, IconLock, IconPlus } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { slugify } from "@/lib/slug";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,10}[a-z0-9]$|^[a-z0-9]{2}$/;

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
  const addProject = useBoardStore((s) => s.addProject);
  const selectProject = useBoardStore((s) => s.selectProject);
  const t = useTranslation();
  const tn = t.newProject;
  const formId = useId();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [remote, setRemote] = useState("");
  const [createGithub, setCreateGithub] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [githubWarning, setGithubWarning] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setSlugError(null);
    setRepoPath("");
    setDefaultBranch("main");
    setRemote("");
    setCreateGithub(false);
    setRepoName("");
    setIsPrivate(true);
    setAiPrompt("");
    setError(null);
    setGithubWarning(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoPath.trim()) {
      setError(tn.errorRequired);
      return;
    }
    const finalSlug = slug.trim() || slugify(name.trim());
    if (!SLUG_REGEX.test(finalSlug)) {
      setSlugError(tn.slugError);
      return;
    }
    setSlugError(null);
    setSubmitting(true);
    setError(null);
    setGithubWarning(null);
    try {
      const trimmedPrompt = aiPrompt.trim();
      const { project, githubError } = await api.createProject({
        name: name.trim(),
        slug: finalSlug,
        repoPath: repoPath.trim(),
        defaultBranch: defaultBranch.trim() || "main",
        remote: createGithub ? undefined : (remote.trim() || null),
        ...(createGithub && {
          createGithubRepo: true,
          repoName: repoName.trim() || undefined,
          isPrivate,
        }),
        ...(trimmedPrompt && {
          aiPrompt: trimmedPrompt,
        }),
      });
      addProject(project);
      selectProject(project.id);
      if (githubError) {
        setGithubWarning(githubError);
        setSubmitting(false);
        return;
      }
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const req = (label: string) => (
    <>
      {label}
      <span aria-hidden className="ml-1 text-[var(--red-text)]">*</span>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={tn.modalTitle}
      description={tn.modalHint}
      icon={<IconFolder size={18} />}
      size="lg"
      footer={
        githubWarning ? (
          <Button variant="primary" onClick={() => { reset(); onClose(); }}>
            {tn.close}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={submitting}>
              {tn.cancel}
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              icon={<IconPlus size={15} />}
              loading={submitting}
            >
              {submitting ? tn.submitting : tn.submit}
            </Button>
          </>
        )
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label={req(tn.nameLabel)}>
            {({ id }) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={(e) => {
                  if (!slugEdited && e.target.value.trim()) setSlug(slugify(e.target.value.trim()));
                }}
                placeholder={tn.namePlaceholder}
                autoFocus
                disabled={submitting}
              />
            )}
          </Field>

          <Field
            label={tn.slugLabel}
            aside={`${String(slug.length).padStart(2, "0")}/12`}
            hint={slugError ? undefined : tn.slugHint}
            error={slugError ?? undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={slug}
                onChange={(e) => {
                  const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 12);
                  setSlug(v);
                  setSlugEdited(true);
                  setSlugError(null);
                }}
                onBlur={() => {
                  if (slug && !SLUG_REGEX.test(slug)) setSlugError(tn.slugError);
                }}
                className="font-mono"
                placeholder={tn.slugPlaceholder}
                disabled={submitting}
                maxLength={12}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label={req(tn.repoPathLabel)}>
            {({ id }) => (
              <Input
                id={id}
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                icon={<IconFolder size={14} />}
                className="font-mono"
                placeholder="/home/user/projects/my-repo"
                disabled={submitting}
              />
            )}
          </Field>
          <Field label={tn.defaultBranchLabel}>
            {({ id }) => (
              <Input
                id={id}
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                icon={<IconBranch size={14} />}
                className="font-mono"
                placeholder="main"
                disabled={submitting}
              />
            )}
          </Field>
        </div>

        <Field label={tn.aiPromptLabel}>
          {({ id }) => (
            <Textarea
              id={id}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={3}
              className="resize-none"
              placeholder={tn.aiPromptPlaceholder}
              disabled={submitting}
            />
          )}
        </Field>

        {/* GitHub repo creation */}
        <div className="flex flex-col gap-3 rounded-[12px] border-2 border-line bg-sunken p-3">
          <label className="ui-option">
            <input
              type="checkbox"
              className="ui-check"
              checked={createGithub}
              onChange={(e) => setCreateGithub(e.target.checked)}
              disabled={submitting}
            />
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border-2 border-line bg-ink text-[var(--on-ink)]"
            >
              <IconGithub size={16} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13.5px] font-semibold text-ink">{tn.createGithubLabel}</span>
              <span className="text-[12px] text-ink-3">{tn.createGithubHint}</span>
            </span>
          </label>

          {createGithub ? (
            <div className="grid gap-4 px-1 pb-1 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label={tn.repoNameLabel}>
                {({ id }) => (
                  <Input
                    id={id}
                    size="sm"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    className="font-mono"
                    placeholder={name.trim() || tn.namePlaceholder}
                    disabled={submitting}
                  />
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink">{tn.visibilityLabel}</span>
                <Segmented
                  size="sm"
                  label={tn.visibilityLabel}
                  value={isPrivate ? "private" : "public"}
                  onChange={(v) => setIsPrivate(v === "private")}
                  options={[
                    { value: "private", label: tn.visibilityPrivate, icon: <IconLock size={12} />, disabled: submitting },
                    { value: "public", label: tn.visibilityPublic, disabled: submitting },
                  ]}
                />
              </div>
            </div>
          ) : (
            <div className="px-1 pb-1">
              <Field label={tn.remoteLabel}>
                {({ id }) => (
                  <Input
                    id={id}
                    size="sm"
                    value={remote}
                    onChange={(e) => setRemote(e.target.value)}
                    icon={<IconArrowUpRight size={13} />}
                    className="font-mono"
                    placeholder="git@github.com:org/repo.git"
                    disabled={submitting}
                  />
                )}
              </Field>
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="ui-banner ui-banner--error">
            <IconAlert size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {githubWarning && (
          <div role="alert" className="ui-banner ui-banner--warn">
            <IconAlert size={15} className="mt-0.5 shrink-0" />
            <span>
              {tn.githubWarningPrefix}
              {githubWarning}
            </span>
          </div>
        )}
      </form>
    </Modal>
  );
}
