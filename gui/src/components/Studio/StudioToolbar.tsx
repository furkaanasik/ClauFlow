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
  onAgentCreated: (slug: string) => void;
  genOpen: boolean;
  onSetGenOpen: (v: boolean) => void;
}

const RECOMMENDED_MAX_AGENTS = 5;

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
      {/* Generate modal */}
      {genOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => { if (e.target === e.currentTarget) { studioReset(); setGenOpen(false); } }}
        >
          <div className="flex w-full max-w-xl flex-col gap-4 border border-[var(--cf-border)] bg-[var(--cf-bg)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--cf-text)]">
                Generate from prompt
              </span>
              <button
                type="button"
                onClick={() => { studioReset(); setGenOpen(false); }}
                className="border border-[var(--cf-border)] p-1.5 text-[var(--cf-muted)] transition hover:text-[var(--cf-text)]"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-[0.08em] text-[var(--cf-muted)]">
                Describe the agent
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isRunning}
                rows={4}
                spellCheck={false}
                placeholder="e.g. A backend agent that reviews API routes for security issues..."
                className="w-full resize-y border border-[var(--cf-border)] bg-[var(--cf-surface)] px-3 py-2 text-[12px] leading-relaxed text-[var(--cf-text)] placeholder:text-[var(--cf-muted)] outline-none transition focus:border-[var(--cf-muted)] disabled:opacity-60"
              />
            </div>

            {installedSkills.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--cf-muted)]">
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
                          ? "border-[var(--cf-text)] bg-[var(--cf-text)] text-[var(--cf-bg)]"
                          : "border-[var(--cf-border)] bg-[var(--cf-surface)] text-[var(--cf-muted)] hover:border-[var(--cf-muted)] hover:text-[var(--cf-text)]",
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
                style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 5, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                {isRunning ? "Generating..." : "Generate"}
              </button>
              {isError && studioGeneration.error && (
                <span className="text-[12px] text-[#ef4444]">
                  {studioGeneration.error}
                </span>
              )}
            </div>

            {(isRunning || isDone) && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--cf-muted)]">
                  Generated agent
                </span>
                <pre className="max-h-48 w-full overflow-auto border border-[var(--cf-border)] bg-[var(--cf-surface)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--cf-text)] whitespace-pre-wrap">
                  {studioGeneration.text || (
                    <span className="italic text-[var(--cf-muted)]">Writing...</span>
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
                  style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 5, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
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
