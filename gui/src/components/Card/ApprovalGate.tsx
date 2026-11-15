"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Textarea } from "@/components/ui/Input";
import { IconAlert, IconArrowUpRight, IconClipboard, IconRetry } from "@/components/ui/icons";
import { errorText } from "@/lib/errorText";
import { useTranslation } from "@/hooks/useTranslation";
import { api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import type { Task, TeamArtifact } from "@/types";

/**
 * Spec approval gate: the run is paused after the Analyst. The user may edit the
 * spec, then "Approve and continue" resumes the team from the Developer with that
 * text; "Cancel" aborts the paused run (task back to TODO).
 */
export function ApprovalGate({ task, spec }: { task: Task; spec: TeamArtifact }) {
  const t = useTranslation();
  const ta = t.team.approval;
  const upsertTask = useBoardStore((s) => s.upsertTask);
  const upsertTeamArtifact = useBoardStore((s) => s.upsertTeamArtifact);

  const [draft, setDraft] = useState(spec.body);
  const [approving, setApproving] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A newer spec (WS) replaces the draft only while the user hasn't edited it.
  const [baseline, setBaseline] = useState(spec.body);
  useEffect(() => {
    if (spec.body !== baseline) {
      setDraft((d) => (d === baseline ? spec.body : d));
      setBaseline(spec.body);
    }
  }, [spec.body, baseline]);

  const edited = draft.trim() !== spec.body.trim();
  const busy = approving || aborting;

  const approve = async () => {
    if (!draft.trim()) return;
    setApproving(true);
    setError(null);
    try {
      const res = await api.approveTeamSpec(task.id, edited ? draft : undefined);
      upsertTeamArtifact(res.artifact);
      upsertTask(res.task);
    } catch (err) {
      setError(err instanceof Error ? `${ta.error} ${err.message}` : ta.error);
    } finally {
      setApproving(false);
    }
  };

  const cancel = async () => {
    setConfirmCancel(false);
    setAborting(true);
    setError(null);
    try {
      await api.abortTask(task.id);
    } catch (err) {
      setError(errorText(t, err, t.taskDetail.abortFailed));
    } finally {
      setAborting(false);
    }
  };

  return (
    <section aria-labelledby={`approval-${spec.id}`} className="ui-banner ui-banner--approval !flex-col !items-stretch !gap-3 !p-4">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border-2 border-line bg-mustard text-[var(--on-mustard)] shadow-hard"
        >
          <IconClipboard size={15} />
        </span>
        <div className="min-w-0">
          <h3 id={`approval-${spec.id}`} className="text-[14.5px] font-bold text-ink">
            {ta.title}
          </h3>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{ta.hint}</p>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`approval-spec-${spec.id}`} className="text-[13px] font-semibold text-ink">
            {ta.specLabel}
          </label>
          {edited && (
            <button
              type="button"
              onClick={() => setDraft(spec.body)}
              disabled={busy}
              className="ui-focus inline-flex items-center gap-1 rounded-[6px] text-[12px] font-semibold text-[var(--cobalt-text)]"
            >
              <IconRetry size={12} />
              {ta.reset}
            </button>
          )}
        </div>
        <Textarea
          id={`approval-spec-${spec.id}`}
          mono
          rows={12}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          className="resize-y !text-[12.5px]"
        />
        {edited && (
          <p className="font-mono text-[11px] text-ink-3">· {t.team.timeline.edited}</p>
        )}
      </div>

      {error && (
        <div role="alert" className="ui-banner ui-banner--error">
          <IconAlert size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setConfirmCancel(true)} loading={aborting} disabled={approving}>
          {ta.cancel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          iconRight={<IconArrowUpRight size={14} />}
          onClick={approve}
          loading={approving}
          disabled={aborting || !draft.trim()}
        >
          {approving ? ta.approving : ta.approve}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={ta.confirmTitle}
        description={ta.confirmDescription}
        confirmLabel={ta.confirm}
        cancelLabel={ta.keep}
        variant="danger"
        onConfirm={cancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </section>
  );
}
