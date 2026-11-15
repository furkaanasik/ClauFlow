"use client";

import { useId, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { PriorityMark } from "@/components/ui/Pills";
import { IconAlert, IconArrowUpRight, IconPlus } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { TeamPicker } from "@/components/Team/TeamPicker";
import { useBoardStore } from "@/store/boardStore";
import { useToast } from "@/hooks/useToast";
import { errorText } from "@/lib/errorText";
import { useTranslation } from "@/hooks/useTranslation";

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
}

type Priority = "low" | "medium" | "high" | "critical";

const PRIO_LIST: Priority[] = ["low", "medium", "high", "critical"];

export function AddTaskModal({ open, onClose }: AddTaskModalProps) {
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const projects = useBoardStore((s) => s.projects);
  const upsertTask = useBoardStore((s) => s.upsertTask);
  const toast = useToast();
  const t = useTranslation();
  const formId = useId();

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [budgetUsd, setBudgetUsd] = useState<string>("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle(""); setDescription(""); setAnalysis(""); setPriority("medium");
    setBudgetUsd(""); setTeamId(null); setError(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) { setError(t.addTask.errorNoProject); return; }
    if (!title.trim())       { setError(t.addTask.errorNoTitle);    return; }
    setLoading(true);
    setError(null);
    try {
      const parsedBudget = budgetUsd.trim() ? parseFloat(budgetUsd) : undefined;
      const task = await api.createTask({
        projectId: selectedProjectId,
        title:       title.trim(),
        description: description.trim() || undefined,
        analysis:    analysis.trim()    || undefined,
        priority,
        budgetUsd:     parsedBudget && !isNaN(parsedBudget) ? parsedBudget : null,
        teamId,
      });
      upsertTask(task);
      toast.success(t.addTask.successToast);
      handleClose();
    } catch (err) {
      setError(errorText(t, err, t.addTask.errorGeneric));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t.addTask.modalTitle}
      description={t.addTask.modalHint}
      icon={<IconPlus size={18} />}
      size="xl"
      footerStart={
        selectedProject && (
          <span className="flex items-center gap-1.5">
            <span className="ui-keyplate !h-5 !text-[10px]">{selectedProject.slug?.toLocaleUpperCase("en") ?? "—"}</span>
            <span className="truncate font-semibold text-ink-2">{selectedProject.name}</span>
          </span>
        )
      }
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t.addTask.cancel}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={loading} iconRight={<IconArrowUpRight size={15} />}>
            {loading ? t.addTask.submitting : t.addTask.submit}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="grid gap-x-6 gap-y-5 md:grid-cols-[minmax(0,1fr)_19.5rem]">
        {/* Writing column */}
        <div className="flex min-w-0 flex-col gap-5">
          <Field label={<Required>{t.addTask.titleLabel}</Required>}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.addTask.titlePlaceholder}
                className="!text-[15px] !font-semibold"
                autoFocus
              />
            )}
          </Field>

          <Field label={t.addTask.descriptionLabel}>
            {({ id }) => (
              <Textarea
                id={id}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.addTask.descriptionPlaceholder}
                rows={3}
                className="resize-none"
              />
            )}
          </Field>

          <Field label={t.addTask.analysisLabel} hint={t.addTask.analysisHint}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                mono
                value={analysis}
                onChange={(e) => setAnalysis(e.target.value)}
                placeholder={t.addTask.analysisPlaceholder}
                rows={9}
                className="resize-y"
              />
            )}
          </Field>
        </div>

        {/* Settings column */}
        <div className="flex flex-col gap-5 rounded-[12px] border-2 border-line bg-sunken p-4 md:self-start">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-ink">{t.addTask.priorityLabel}</span>
            <div role="radiogroup" aria-label={t.addTask.priorityLabel} className="grid grid-cols-2 gap-2">
              {PRIO_LIST.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={priority === value}
                  onClick={() => setPriority(value)}
                  className="ui-option !gap-2 !px-2.5 !py-2 text-[13px] font-semibold"
                >
                  <PriorityMark level={value} label={t.addTask.priorities[value]} />
                  {t.addTask.priorities[value]}
                </button>
              ))}
            </div>
          </div>

          <TeamPicker
            project={selectedProject ?? null}
            value={teamId}
            onChange={setTeamId}
            refreshKey={open}
          />

          <Field label={t.addTask.budgetLabel} aside={t.addTask.optional}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min="0.1"
                step="0.1"
                size="sm"
                icon={<span className="font-mono text-[13px] font-bold">$</span>}
                value={budgetUsd}
                onChange={(e) => setBudgetUsd(e.target.value)}
                placeholder={t.addTask.budgetPlaceholder}
                className="font-mono"
              />
            )}
          </Field>
        </div>

        {error && (
          <div role="alert" className="ui-banner ui-banner--error md:col-span-2">
            <IconAlert size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

function Required({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <span aria-hidden className="ml-1 text-[var(--red-text)]">*</span>
    </>
  );
}
