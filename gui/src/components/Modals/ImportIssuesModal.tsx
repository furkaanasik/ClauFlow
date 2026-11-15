"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Toggle";
import { Tag } from "@/components/ui/Chip";
import { IconAlert, IconArrowUpRight, IconDownload, IconGithub, IconSpinner } from "@/components/ui/icons";
import { githubApi, type GhIssue } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";

interface ImportIssuesModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportIssuesModal({ open, onClose }: ImportIssuesModalProps) {
  const selectedProjectId = useBoardStore((s) => s.selectedProjectId);
  const upsertTask = useBoardStore((s) => s.upsertTask);
  const openProjectDetail = useBoardStore((s) => s.openProjectDetail);
  const toast = useToast();
  const t = useTranslation();
  const ti = t.importIssues;

  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadErrorText = ti.loadError;
  useEffect(() => {
    if (!open || !selectedProjectId) return;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setSelected(new Set());
    githubApi.listIssues(selectedProjectId)
      .then((r) => setIssues(r.issues))
      .catch((err) => setLoadError(err instanceof Error ? err.message : loadErrorText))
      .finally(() => setLoading(false));
  }, [open, selectedProjectId, loadErrorText]);

  const allSelected = issues.length > 0 && selected.size === issues.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(issues.map((i) => i.number)));
  };

  const toggle = (number: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  const handleImport = async () => {
    if (!selectedProjectId || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const toImport = issues.filter((i) => selected.has(i.number));
      const { tasks } = await githubApi.importIssues(selectedProjectId, toImport);
      tasks.forEach((task) => upsertTask(task));
      toast.success(ti.successToast(tasks.length));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : ti.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  const ready = !loading && !loadError && issues.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ti.modalTitle}
      description={ti.modalHint}
      icon={<IconGithub size={18} />}
      size="lg"
      footerStart={ready ? ti.selectedCount(selected.size, issues.length) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {ti.cancel}
          </Button>
          {ready && (
            <Button
              variant="primary"
              icon={<IconDownload size={15} />}
              onClick={handleImport}
              disabled={selected.size === 0}
              loading={saving}
            >
              {saving ? ti.importing : ti.importButton(selected.size)}
            </Button>
          )}
        </>
      }
    >
      {loading && (
        <div className="flex flex-col gap-2" aria-busy>
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <IconSpinner size={14} />
            {ti.loading}
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="ui-hatch h-[3.25rem] rounded-[10px] border-2 border-dashed border-hair" />
          ))}
        </div>
      )}

      {!loading && loadError && (
        <div className="ui-hatch flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-10 text-center">
          <span
            aria-hidden
            className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-red text-[var(--on-red)] shadow-hard"
          >
            <IconAlert size={20} />
          </span>
          <p className="t-display text-[18px] text-ink">{ti.loadError}</p>
          <p className="max-w-md font-mono text-[12px] leading-relaxed text-ink-2">{loadError}</p>
          {selectedProjectId && (
            <Button
              size="sm"
              variant="secondary"
              iconRight={<IconArrowUpRight size={13} />}
              onClick={() => {
                onClose();
                openProjectDetail(selectedProjectId);
              }}
            >
              {ti.noRemoteHint} · {ti.configureLink.replace(/\s*→\s*$/, "")}
            </Button>
          )}
        </div>
      )}

      {!loading && !loadError && issues.length === 0 && (
        <div className="ui-hatch flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-10 text-center">
          <span
            aria-hidden
            className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-panel text-ink-2 shadow-hard"
          >
            <IconGithub size={20} />
          </span>
          <p className="text-[13px] text-ink-2">{ti.empty}</p>
        </div>
      )}

      {ready && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 border-b-2 border-dashed border-hair pb-2.5">
            <Checkbox checked={allSelected} onChange={toggleAll} label={allSelected ? ti.deselectAll : ti.selectAll} />
          </div>
          <ul className="flex max-h-[420px] flex-col gap-2 overflow-y-auto p-1">
            {issues.map((issue) => {
              const checked = selected.has(issue.number);
              return (
                <li key={issue.number}>
                  <label className="ui-option !items-start" data-checked={checked}>
                    <input
                      type="checkbox"
                      className="ui-check mt-0.5"
                      checked={checked}
                      onChange={() => toggle(issue.number)}
                    />
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-[13.5px] font-semibold leading-snug text-ink">
                        <span className="mr-1.5 font-mono text-[12px] text-ink-3">
                          {ti.issueNumber}
                          {issue.number}
                        </span>
                        {issue.title}
                      </span>
                      {issue.labels.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {issue.labels.map((l) => (
                            /* label colour comes from GitHub, so it is data, not a theme colour */
                            <Tag key={l.name} dot={`#${l.color}`} className="!h-5 !text-[11px]">
                              {l.name}
                            </Tag>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {error && (
            <div role="alert" className="ui-banner ui-banner--error">
              <IconAlert size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
