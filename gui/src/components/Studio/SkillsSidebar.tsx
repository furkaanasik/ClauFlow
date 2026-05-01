"use client";

import { useEffect, useState } from "react";
import { api, type InstalledPlugin } from "@/lib/api";
import { SkillsManagerModal } from "@/components/Modals/SkillsManagerModal";
import { skillDragState } from "./dragState";

interface SkillsSidebarProps {
  projectId: string;
  onSkillsChanged?: () => void;
}

export function SkillsSidebar({ projectId, onSkillsChanged }: SkillsSidebarProps) {
  const [skills, setSkills] = useState<InstalledPlugin[] | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const load = async () => {
    try {
      const data = await api.listInstalledSkills(projectId);
      setSkills(data.installed);
    } catch {
      setSkills([]);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragStart = (e: React.DragEvent, pluginId: string) => {
    e.dataTransfer.setData("application/x-skill-id", pluginId);
    e.dataTransfer.effectAllowed = "copy";
    skillDragState.skillId = pluginId;
  };

  const handleDragEnd = () => {
    skillDragState.skillId = null;
  };

  const handleManageClose = () => {
    setManageOpen(false);
    void load();
    onSkillsChanged?.();
  };

  return (
    <>
      <div className="flex w-48 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Skills
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {skills === null ? (
            <div className="flex justify-center py-4">
              <svg className="h-4 w-4 animate-spin text-[var(--text-muted)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : skills.length === 0 ? (
            <div className="px-1 py-3 text-center text-[10px] text-[var(--text-faint)]">
              No skills installed
            </div>
          ) : (
            skills.map((sk) => (
              <div
                key={sk.id}
                draggable
                onDragStart={(e) => handleDragStart(e, sk.id)}
                onDragEnd={handleDragEnd}
                className="cursor-grab rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 font-mono text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] active:cursor-grabbing"
                title={`Drag to add ${sk.id} to an agent`}
              >
                {sk.id}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[var(--border)] p-2">
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="w-full border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[10px] text-[var(--text-muted)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            + Manage skills
          </button>
        </div>
      </div>

      <SkillsManagerModal
        projectId={projectId}
        open={manageOpen}
        onClose={handleManageClose}
      />
    </>
  );
}
