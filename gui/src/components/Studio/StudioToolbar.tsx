"use client";

import { useState } from "react";
import clsx from "clsx";
import { api, type InstalledPlugin } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useToastStore } from "@/hooks/useToast";
import { slugify } from "@/lib/slug";

interface StudioToolbarProps {
  projectId: string;
  installedSkills: InstalledPlugin[];
  agentCount: number;
  onNewAgent: () => void;
  onAgentCreated: (slug: string) => void;
}

const RECOMMENDED_MAX_AGENTS = 5;

function extractFrontmatterField(markdown: string, field: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return "";
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = match[1].match(re);
  return m ? m[1].trim() : "";
}

export function StudioToolbar({ projectId, installedSkills, agentCount, onNewAgent, onAgentCreated }: StudioToolbarProps) {
  const overLimit = agentCount > RECOMMENDED_MAX_AGENTS;
  const [genOpen, setGenOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const studioGeneration = useBoardStore((s) => s.studioGeneration);
  const studioStart = useBoardStore((s) => s.studioStart);
  const studioReset = useBoardStore((s) => s.studioReset);
  const toast = useToastStore((s) => s.push);

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
        err instanceof Error ? err.message : "Generation failed",
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
      toast("success", "Agent saved");
      studioReset();
      setPrompt("");
      setSelectedSkills(new Set());
      setGenOpen(false);
      onAgentCreated(generatedSlug);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2">
        <button
          type="button"
          onClick={onNewAgent}
          className="btn-ink px-3 py-1.5 text-[11px]"
        >
          + New agent
        </button>
        <button
          type="button"
          onClick={() => setGenOpen(true)}
          className="border border-[var(--border)] bg-[var(--bg-base)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Generate from prompt
        </button>

        <div className="ml-auto">
          <span
            title={
              overLimit
                ? `Recommended max is ${RECOMMENDED_MAX_AGENTS} agents — beyond this, coordinator overhead grows quickly.`
                : `Recommended max for Claude orchestration: ${RECOMMENDED_MAX_AGENTS} agents.`
            }
            className={clsx(
              "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px]",
              overLimit
                ? "border-[var(--status-warning)] bg-[var(--status-warning-ink,transparent)] text-[var(--status-warning)]"
                : "border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-muted)]",
            )}
          >
            <span>{agentCount}</span>
            <span className="text-[var(--text-faint)]">/</span>
            <span>{RECOMMENDED_MAX_AGENTS}</span>
            <span className="text-[var(--text-faint)]">agents</span>
          </span>
        </div>
      </div>

      {/* Generate modal */}
      {genOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) { studioReset(); setGenOpen(false); } }}
        >
          <div className="flex w-full max-w-xl flex-col gap-4 border border-[var(--border)] bg-[var(--bg-base)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)]">
                Generate from prompt
              </span>
              <button
                type="button"
                onClick={() => { studioReset(); setGenOpen(false); }}
                className="border border-[var(--border)] p-1.5 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Describe the agent
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isRunning}
                rows={4}
                spellCheck={false}
                placeholder="e.g. A backend agent that reviews API routes for security issues..."
                className="w-full resize-y border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-60"
              />
            </div>

            {installedSkills.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Skills to include
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {installedSkills.map((sk) => (
                    <button
                      key={sk.id}
                      type="button"
                      onClick={() => toggleSkill(sk.id)}
                      disabled={isRunning}
                      className={clsx(
                        "border px-2 py-0.5 font-mono text-[10px] transition disabled:opacity-50",
                        selectedSkills.has(sk.id)
                          ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-base)]"
                          : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      {sk.id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!prompt.trim() || isRunning}
                className="btn-ink px-4 py-2 text-[12px] disabled:opacity-50"
              >
                {isRunning ? "Generating..." : "Generate"}
              </button>
              {isError && studioGeneration.error && (
                <span className="text-[12px] text-[var(--status-error)]">
                  {studioGeneration.error}
                </span>
              )}
            </div>

            {(isRunning || isDone) && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Generated agent
                </span>
                <pre className="max-h-48 w-full overflow-auto border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
                  {studioGeneration.text || (
                    <span className="italic text-[var(--text-faint)]">Writing...</span>
                  )}
                </pre>
              </div>
            )}

            {isDone && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !studioGeneration.text.trim()}
                  className="btn-ink px-4 py-2 text-[12px] disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save agent"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
