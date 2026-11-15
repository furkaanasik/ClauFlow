"use client";

import { useState } from "react";
import { api, type InstalledPlugin } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useToastStore } from "@/hooks/useToast";
import { slugify } from "@/lib/slug";
import { useTranslation } from "@/hooks/useTranslation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, Textarea } from "@/components/ui/Input";
import { IconAlert, IconBolt, IconCheck } from "@/components/ui/icons";

interface StudioToolbarProps {
  projectId: string;
  installedSkills: InstalledPlugin[];
  onAgentCreated: (slug: string) => void;
  genOpen: boolean;
  onSetGenOpen: (v: boolean) => void;
}

function extractFrontmatterField(markdown: string, field: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return "";
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = match[1].match(re);
  return m ? m[1].trim() : "";
}

export function StudioToolbar({ projectId, installedSkills, onAgentCreated, genOpen, onSetGenOpen }: StudioToolbarProps) {
  const setGenOpen = onSetGenOpen;
  const [prompt, setPrompt] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const studioGeneration = useBoardStore((s) => s.studioGeneration);
  const studioStart = useBoardStore((s) => s.studioStart);
  const studioReset = useBoardStore((s) => s.studioReset);
  const toast = useToastStore((s) => s.push);
  const cc = useTranslation().claudeConfig;

  const isRunning = studioGeneration.status === "running";
  const isDone = studioGeneration.status === "done";
  const isError = studioGeneration.status === "error";

  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isRunning) return;
    const id = Math.random().toString(36).slice(2);
    studioStart(id);
    try {
      await api.postStudioGenerate(projectId, {
        prompt: prompt.trim(),
        skills: selectedSkills.size > 0 ? [...selectedSkills] : undefined,
      });
    } catch (err) {
      useBoardStore.getState().studioError(
        err instanceof Error ? err.message : cc.studioGenerateError,
      );
    }
  };

  const handleSave = async () => {
    const text = studioGeneration.text.trim();
    if (!text) return;
    const name = extractFrontmatterField(text, "name");
    const generatedSlug = slugify(name || "studio-agent");
    setSaving(true);
    try {
      await api.createClaudeAgent(projectId, { slug: generatedSlug, body: text });
      toast("success", cc.studioSaved);
      studioReset();
      setPrompt("");
      setSelectedSkills(new Set());
      setGenOpen(false);
      onAgentCreated(generatedSlug);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : cc.studioSaveError);
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    studioReset();
    setGenOpen(false);
  };

  return (
    <Modal
      open={genOpen}
      onClose={close}
      size="lg"
      icon={<IconBolt size={18} />}
      title={cc.studioGenerateTitle}
      description={cc.studioGenerateHint}
      footerStart={
        isError && studioGeneration.error ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--red-text)]">
            <IconAlert size={13} />
            {studioGeneration.error}
          </span>
        ) : null
      }
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {cc.cancel}
          </Button>
          {isDone ? (
            <Button
              variant="primary"
              icon={<IconCheck size={15} />}
              onClick={() => void handleSave()}
              disabled={!studioGeneration.text.trim()}
              loading={saving}
            >
              {saving ? cc.studioSaving : cc.studioSave}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<IconBolt size={15} />}
              onClick={() => void handleGenerate()}
              disabled={!prompt.trim()}
              loading={isRunning}
            >
              {isRunning ? cc.studioGenerating : cc.studioGenerate}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={cc.studioPromptLabel}>
          {({ id }) => (
            <Textarea
              id={id}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
              rows={4}
              spellCheck={false}
              data-autofocus
              placeholder={cc.studioPromptPlaceholder}
              className="resize-y"
            />
          )}
        </Field>

        {installedSkills.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-ink">{cc.studioSkillsLabel}</span>
            <div className="flex flex-wrap gap-1.5">
              {installedSkills.map((sk) => (
                <Chip
                  key={sk.id}
                  selected={selectedSkills.has(sk.id)}
                  onSelectedChange={() => toggleSkill(sk.id)}
                  disabled={isRunning}
                  className="font-mono !text-[11.5px]"
                >
                  {sk.id}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {(isRunning || isDone) && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-ink">{cc.studioPreviewLabel}</span>
            <pre className="logpane max-h-56 whitespace-pre-wrap !px-4 !py-3 text-[12px] leading-relaxed text-ink">
              {studioGeneration.text || <span className="text-ink-3">{cc.studioWriting}</span>}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  );
}
