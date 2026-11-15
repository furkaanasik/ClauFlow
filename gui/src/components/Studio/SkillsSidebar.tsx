"use client";

import { useEffect, useState } from "react";
import { api, type SkillItem } from "@/lib/api";
import { SkillsManagerModal } from "@/components/Modals/SkillsManagerModal";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { IconGear, IconSearch, IconSpinner, IconTag, IconTerminal } from "@/components/ui/icons";
import { skillDragState } from "./dragState";

type FilterType = "all" | "skill" | "command";

interface SkillsSidebarProps {
  projectId: string;
  onSkillsChanged?: () => void;
}

export function SkillsSidebar({ projectId, onSkillsChanged }: SkillsSidebarProps) {
  const st = useTranslation().studio;
  const [skills, setSkills] = useState<SkillItem[] | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const load = async () => {
    try {
      const data = await api.listSkillItems(projectId);
      setSkills(data.skills);
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

  const visible = (skills ?? []).filter((sk) => {
    if (filter === "skill" && sk.source === "command") return false;
    if (filter === "command" && sk.source !== "command") return false;
    return sk.id.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <>
      <div className="studio-side border-r-2">
        <div className="studio-side__head">
          <IconTag size={14} />
          <span className="flex-1">{st.skillsTitle}</span>
          {skills && <span className="studio-side__count">{skills.length}</span>}
        </div>

        <div className="flex flex-col gap-2 border-b-2 border-dashed border-hair p-2.5">
          <Input
            size="sm"
            icon={<IconSearch size={13} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={st.searchSkills}
            aria-label={st.searchSkills}
          />
          <Segmented<FilterType>
            label={st.skillFilter}
            size="sm"
            value={filter}
            onChange={setFilter}
            className="w-full [&>.ui-seg__item]:flex-1 [&>.ui-seg__item]:justify-center"
            options={[
              { value: "all", label: st.filterAll },
              { value: "skill", label: st.filterSkills },
              { value: "command", label: st.filterCommands },
            ]}
          />
        </div>

        <div role="region" aria-label={st.skillsTitle} tabIndex={0} className="ui-focus focus-visible:outline-offset-[-3px] flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2.5">
          {skills === null ? (
            <div className="flex justify-center py-6 text-ink-3">
              <IconSpinner size={16} />
            </div>
          ) : visible.length === 0 ? (
            <div className="ui-hatch rounded-[10px] border-2 border-dashed border-hair px-3 py-6 text-center text-[12px] text-ink-3">
              {st.noSkills}
            </div>
          ) : (
            visible.map((sk) => (
              <div
                key={sk.id}
                draggable
                onDragStart={(e) => handleDragStart(e, sk.id)}
                onDragEnd={handleDragEnd}
                className="studio-item"
                title={
                  sk.pluginId
                    ? st.dragSkillFromTitle.replace("{skill}", sk.id).replace("{plugin}", sk.pluginId)
                    : st.dragSkillTitle.replace("{skill}", sk.id)
                }
              >
                <span aria-hidden className="studio-item__grip" />
                {sk.source === "command" ? (
                  <IconTerminal size={12} className="flex-none text-ink-3" />
                ) : (
                  <IconTag size={12} className="flex-none text-ink-3" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">{sk.id}</span>
                {sk.source === "plugin" && <span className="studio-item__src">{st.sourcePlugin}</span>}
                {sk.source === "command" && <span className="studio-item__src">{st.sourceCommand}</span>}
              </div>
            ))
          )}
        </div>

        <div className="border-t-2 border-line p-2.5">
          <Button size="sm" variant="secondary" block icon={<IconGear size={13} />} onClick={() => setManageOpen(true)}>
            {st.manageSkills}
          </Button>
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
