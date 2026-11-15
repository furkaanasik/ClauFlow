"use client";

import { useEffect, useState } from "react";
import { api, type ClaudeAgent } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { IconAlert, IconCheck, IconRobot, IconTrash } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";

interface AgentEditDrawerProps {
  projectId: string;
  slug: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  existingSlugs: string[];
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

export function AgentEditDrawer({
  projectId,
  slug,
  open,
  onClose,
  onSaved,
  onDeleted,
  existingSlugs,
}: AgentEditDrawerProps) {
  const t = useTranslation();
  const ca = t.claudeAgents;
  const isEdit = slug !== null;

  const [loading, setLoading] = useState(false);
  const [original, setOriginal] = useState<ClaudeAgent | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const isPresetModel = MODEL_PRESETS.some((m) => m.value === model);
  const modelSelectValue = model === "" ? "" : isPresetModel ? model : "__custom__";

  const resetForm = () => {
    setOriginal(null);
    setNewSlug("");
    setName("");
    setModel("");
    setDescription("");
    setBody("");
    setError(null);
    setSavedFlash(false);
  };

  useEffect(() => {
    if (!open) return;
    if (!isEdit || !slug) {
      resetForm();
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getClaudeAgent(projectId, slug)
      .then((a) => {
        if (cancelled) return;
        setOriginal(a);
        setNewSlug(a.slug);
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
  }, [open, slug, projectId, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug);
  const slugDuplicate = !isEdit && existingSlugs.includes(newSlug);

  const isDirty = isEdit
    ? (original
        ? name !== original.name ||
          model !== (original.model ?? "") ||
          description !== (original.description ?? "") ||
          body !== original.body
        : false)
    : newSlug.length > 0 || name.length > 0 || description.length > 0 || body.length > 0;

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
        name: name || newSlug,
        model: model || undefined,
        description: description || undefined,
        body,
      };
      if (isEdit && slug) {
        await api.updateClaudeAgent(projectId, slug, payload);
      } else {
        await api.createClaudeAgent(projectId, { slug: newSlug, ...payload });
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      onSaved();
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
    if (!isEdit || !slug) return;
    setConfirmDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await api.deleteClaudeAgent(projectId, slug);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : ca.deleteError);
      setDeleting(false);
    }
  };

  const titleText = isEdit ? `${ca.editTitle} · ${slug}` : ca.createTitle;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        icon={<IconRobot size={18} />}
        title={titleText}
        description={ca.modalHint}
        footerStart={
          isEdit && slug !== "main" ? (
            <Button
              size="sm"
              variant="danger"
              icon={<IconTrash size={13} />}
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
              loading={deleting}
            >
              {deleting ? ca.deleting : ca.delete}
            </Button>
          ) : savedFlash ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--green-text)]">
              <IconCheck size={13} />
              {ca.saved}
            </span>
          ) : null
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {ca.cancel}
            </Button>
            <Button
              variant="primary"
              icon={<IconCheck size={15} />}
              onClick={() => void submit()}
              disabled={!canSave}
              loading={saving}
            >
              {saving
                ? (isEdit ? ca.saving : ca.creating)
                : (isEdit ? ca.save : ca.create)}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="ui-banner ui-banner--error">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={ca.slugLabel}
              hint={isEdit ? undefined : ca.slugHint}
              error={
                !isEdit && newSlug && !slugValid
                  ? ca.slugError
                  : !isEdit && slugValid && slugDuplicate
                    ? ca.duplicate
                    : undefined
              }
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  disabled={isEdit || loading || saving}
                  placeholder={ca.slugPlaceholder}
                  spellCheck={false}
                  className="font-mono"
                />
              )}
            </Field>
            <Field label={ca.nameLabel}>
              {({ id }) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading || saving}
                  placeholder={ca.namePlaceholder}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={ca.modelLabel}>
              {({ id }) => (
                <div className="flex flex-col gap-2">
                  <Select
                    id={id}
                    value={modelSelectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") setModel("");
                      else if (v === "__custom__") setModel(isPresetModel ? "" : model || " ");
                      else setModel(v);
                    }}
                    disabled={loading || saving}
                    className="font-mono"
                  >
                    <option value="">{ca.modelInherit}</option>
                    {MODEL_PRESETS.filter((m) => m.value !== "inherit").map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                    <option value="__custom__">{ca.modelCustom}</option>
                  </Select>
                  {modelSelectValue === "__custom__" && (
                    <Input
                      value={model.trim()}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={loading || saving}
                      placeholder={ca.modelCustomPlaceholder}
                      aria-label={ca.modelCustomPlaceholder}
                      spellCheck={false}
                      autoFocus
                      className="font-mono"
                    />
                  )}
                </div>
              )}
            </Field>
            <Field label={ca.descriptionLabel}>
              {({ id }) => (
                <Input
                  id={id}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loading || saving}
                  placeholder={ca.descriptionPlaceholder}
                />
              )}
            </Field>
          </div>

          <Field label={ca.bodyLabel} aside={ca.lines(body ? body.split("\n").length : 0)}>
            {({ id }) => (
              <Textarea
                id={id}
                mono
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={loading || saving}
                rows={16}
                spellCheck={false}
                placeholder={ca.bodyPlaceholder}
                className="resize-y !bg-sunken leading-relaxed"
              />
            )}
          </Field>
        </div>
      </Modal>

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
    </>
  );
}

export type { AgentEditDrawerProps };
