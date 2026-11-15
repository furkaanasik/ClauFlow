"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { IconAlert, IconClose, IconSpinner } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";
import type { Project } from "@/types";

/**
 * On a fresh page load we never saw `project_planning_started`, so the only
 * start hint is `createdAt`. That is only trustworthy when the project is new
 * (planning kicks off on create); a re-plan after a prompt edit would make it
 * wrong, so past this window we show no timer at all.
 */
const CREATED_AT_TRUST_MS = 10 * 60 * 1000;

const DISMISS_KEY = "planner-error-dismissed";

function readDismissed(projectId: string): string | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? ((JSON.parse(raw) as Record<string, string>)[projectId] ?? null) : null;
  } catch {
    return null;
  }
}

function writeDismissed(projectId: string, error: string) {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[projectId] = error;
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {}
}

function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function usePlanningStart(project: Project): number | null {
  const seenAt = useBoardStore((s) => s.planningStartedAt[project.id]);
  if (seenAt != null) return seenAt;
  if (!project.createdAt) return null;
  const created = Date.parse(project.createdAt);
  if (Number.isNaN(created)) return null;
  const age = Date.now() - created;
  // Negative beyond a little clock skew, or too old to be the initial run: no timer.
  if (age < -60_000 || age > CREATED_AT_TRUST_MS) return null;
  return created;
}

function ElapsedTimer({ start, label }: { start: number; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const text = formatElapsed(Math.max(0, now - start));
  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 pl-2">
      <span className="t-label !text-ink-3">{label}</span>
      {/* aria-hidden: a ticking clock would spam screen readers every second */}
      <span aria-hidden className="font-mono text-[18px] font-semibold leading-none tabular-nums text-ink">
        {text}
      </span>
    </div>
  );
}

function PlanningBanner({ project }: { project: Project }) {
  const t = useTranslation().board.planner;
  const start = usePlanningStart(project);
  return (
    <div role="status" className="ui-banner ui-banner--info shrink-0 items-center !gap-3 !py-2.5 !pl-3.5 !pr-4">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border-2 border-line"
        style={{ background: "var(--cobalt)", color: "var(--on-cobalt)" }}
      >
        <IconSpinner size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold leading-snug text-ink">{t.title}</p>
        <p className="text-[12.5px] leading-snug text-ink-2">{t.body}</p>
      </div>
      {start != null && <ElapsedTimer start={start} label={t.elapsed} />}
    </div>
  );
}

function ErrorBanner({ project, onDismiss }: { project: Project; onDismiss: () => void }) {
  const t = useTranslation().board.planner;
  return (
    <div role="alert" className="ui-banner ui-banner--error shrink-0 items-start !gap-3 !py-2.5 !pl-3.5 !pr-2.5">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border-2 border-line"
        style={{ background: "var(--red)", color: "var(--on-red)" }}
      >
        <IconAlert size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold leading-snug">{t.errorTitle}</p>
        {project.planningError && (
          <p
            className="mt-0.5 line-clamp-3 break-words font-mono text-[12px] leading-snug text-ink"
            title={project.planningError}
          >
            {project.planningError}
          </p>
        )}
        <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{t.errorHint}</p>
      </div>
      <IconButton label={t.dismiss} size="sm" variant="ghost" onClick={onDismiss}>
        <IconClose size={13} />
      </IconButton>
    </div>
  );
}

/** Planner progress for the open project — sits above every board view. */
export function PlannerBanner({ project }: { project: Project | undefined }) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  const id = project?.id;
  useEffect(() => {
    setDismissed(id ? readDismissed(id) : null);
  }, [id]);

  if (!project) return null;
  if (project.planningStatus === "planning") return <PlanningBanner project={project} />;
  if (project.planningStatus === "error") {
    const key = project.planningError ?? "";
    if (dismissed === key) return null;
    return (
      <ErrorBanner
        project={project}
        onDismiss={() => {
          writeDismissed(project.id, key);
          setDismissed(key);
        }}
      />
    );
  }
  return null;
}
