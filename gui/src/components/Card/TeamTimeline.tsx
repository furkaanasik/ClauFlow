"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Select } from "@/components/ui/Input";
import { StatusPill, type StatusKind } from "@/components/ui/Pills";
import { IconAlert, IconBranch, IconCheck, IconClose, IconCoin, IconTeam } from "@/components/ui/icons";
import { RoleChain, RolePlate } from "@/components/Team/RoleChain";
import { ROLE_TONE, fill, roleLabel, teamName, teamStepKind } from "@/components/Team/roleMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { formatTokens, totalTokens } from "@/lib/cost";
import { useBoardStore } from "@/store/boardStore";
import type { NodeRun, Task, TeamArtifact, TeamRun, TeamRunStatus } from "@/types";

type Translations = ReturnType<typeof useTranslation>;

const EMPTY_RUNS: TeamRun[] = [];
const EMPTY_ARTIFACTS: TeamArtifact[] = [];
const EMPTY_NODES: Record<string, NodeRun> = {};

const RUN_STATUS_KIND: Record<TeamRunStatus, StatusKind> = {
  running: "doing",
  awaiting_approval: "review",
  delivered: "done",
  explored: "done",
  stuck: "error",
  error: "error",
  aborted: "todo",
};

interface TeamTimelineProps {
  task: Task;
  /** Rendered right after the spec the run is paused on (the approval gate). */
  renderApproval?: (spec: TeamArtifact) => ReactNode;
}

/**
 * The team's work as a conversation: one bubble per role output (brief, spec,
 * delivery, QA report), the stuck card and the closing summary, plus a live
 * "typing" bubble for the role currently running.
 */
export function TeamTimeline({ task, renderApproval }: TeamTimelineProps) {
  const t = useTranslation();
  const tl = t.team.timeline;
  const runs = useBoardStore((s) => s.teamRuns[task.id] ?? EMPTY_RUNS);
  const artifacts = useBoardStore((s) => s.teamArtifacts[task.id] ?? EMPTY_ARTIFACTS);
  const nodeRuns = useBoardStore((s) => s.nodeRuns[task.id] ?? EMPTY_NODES);

  const latest = runs[runs.length - 1] ?? null;
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);
  // Follow the newest run unless the user picked an older one.
  const run = runs.find((r) => r.id === pickedRunId) ?? latest;
  useEffect(() => {
    if (pickedRunId && !runs.some((r) => r.id === pickedRunId)) setPickedRunId(null);
  }, [runs, pickedRunId]);

  const runArtifacts = useMemo(
    () => (run ? artifacts.filter((a) => a.runId === run.id) : EMPTY_ARTIFACTS),
    [artifacts, run],
  );
  const nodeById = useMemo(() => {
    const m = new Map<string, NodeRun>();
    for (const n of Object.values(nodeRuns)) m.set(n.id, n);
    return m;
  }, [nodeRuns]);

  if (!run) {
    return (
      <div className="ui-hatch flex flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-12 text-center">
        <span
          aria-hidden
          className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-panel text-ink-2 shadow-hard"
        >
          <IconTeam size={20} />
        </span>
        <p className="text-[14px] font-semibold text-ink">{tl.empty}</p>
        <p className="max-w-sm text-[13px] text-ink-2">{tl.emptyHint}</p>
      </div>
    );
  }

  const isLatest = run.id === latest?.id;
  const activeKind = isLatest && run.status === "running" && task.status === "doing" ? teamStepKind(task.agent.currentStep) : null;
  const activeRole = activeKind ? run.teamSnapshot.roles.find((r) => r.kind === activeKind) ?? null : null;
  const awaitingSpecId =
    isLatest && run.status === "awaiting_approval"
      ? [...runArtifacts].reverse().find((a) => a.kind === "spec")?.id ?? null
      : null;
  const stopReason = run.stopReason ? stopReasonLabel(run.stopReason, t) : null;

  return (
    <section aria-label={tl.label} className="flex flex-col gap-4">
      {/* Run header: team, role order, status, cost */}
      <div className="flex flex-col gap-3 rounded-[14px] border-2 border-line bg-panel p-3.5 shadow-hard">
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-label !text-ink-2">{tl.teamLabel}</span>
          <span className="text-[14px] font-bold text-ink">{teamName(run.teamSnapshot, t)}</span>
          <StatusPill
            status={RUN_STATUS_KIND[run.status]}
            variant={run.status === "running" || run.status === "awaiting_approval" ? "solid" : "soft"}
            live={run.status === "running"}
          >
            {t.team.runStatus[run.status]}
          </StatusPill>
          <span className="ml-auto flex items-center gap-1.5">
            {run.qaRound > 0 && (
              <span className="team-chip" title={tl.qaRounds}>
                {tl.qaRounds} {run.qaRound}
              </span>
            )}
            <span className="team-chip" title={tl.totalCost}>
              <IconCoin size={12} />${run.costUsd.toFixed(2)}
            </span>
          </span>
        </div>
        <RoleChain roles={run.teamSnapshot.roles} />
        {runs.length > 1 && (
          <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
            {tl.runSelect}
            <Select
              size="sm"
              className="max-w-[16rem]"
              value={run.id}
              onChange={(e) => setPickedRunId(e.target.value === latest?.id ? null : e.target.value)}
            >
              {runs.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {fill(tl.runOption, { n: i + 1 })} · {t.team.runStatus[r.status]}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      <ol className="flex flex-col gap-4">
        {runArtifacts.map((a) => (
          <li key={a.id} className="flex flex-col gap-4">
            <ArtifactBubble
              artifact={a}
              run={run}
              node={a.nodeRunId ? nodeById.get(a.nodeRunId) ?? null : null}
              stopReason={stopReason}
              t={t}
            />
            {a.id === awaitingSpecId && task.agent.status === "awaiting_approval" && renderApproval?.(a)}
          </li>
        ))}
        {activeKind && (
          <li>
            <LiveBubble
              name={roleLabel(activeRole, activeKind, t)}
              kind={activeKind}
              label={
                t.team.activity[activeKind] +
                (run.qaRound > 0 && (activeKind === "developer" || activeKind === "qa")
                  ? ` ${fill(t.team.roundSuffix, { n: run.qaRound + 1 })}`
                  : "")
              }
            />
          </li>
        )}
      </ol>
    </section>
  );
}

function stopReasonLabel(reason: string, t: Translations): string {
  return reason in t.team.stopReasons ? t.team.stopReasons[reason as keyof Translations["team"]["stopReasons"]] : reason;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ─── Bubbles ────────────────────────────────────────────────────────────── */

function ArtifactBubble({
  artifact: a,
  run,
  node,
  stopReason,
  t,
}: {
  artifact: TeamArtifact;
  run: TeamRun;
  node: NodeRun | null;
  stopReason: string | null;
  t: Translations;
}) {
  const tl = t.team.timeline;
  const kind = a.roleKind;
  const role = kind ? run.teamSnapshot.roles.find((r) => r.id === a.roleId) ?? null : null;

  if (a.kind === "stuck") {
    return (
      <div className="flex gap-3">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border-2 border-line bg-red text-[var(--on-red)] shadow-hard"
        >
          <IconAlert size={15} />
        </span>
        <article className="team-bubble flex-1" data-tone="stuck">
          <header className="team-bubble__head">
            <span className="text-[13.5px] font-bold text-[var(--red-text)]">{tl.stuckTitle}</span>
            {stopReason && (
              <StatusPill status="error" variant="solid">
                {stopReason}
              </StatusPill>
            )}
            <time className="ml-auto font-mono text-[11px] text-ink-3" dateTime={a.createdAt}>
              {timeOf(a.createdAt)}
            </time>
          </header>
          <MarkdownBody body={a.body} t={t} />
        </article>
      </div>
    );
  }

  if (!kind) {
    // ClauFlow's own summary (comment that closes the run)
    return (
      <div className="flex gap-3">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border-2 border-line bg-ink font-mono text-[11px] font-extrabold text-[var(--on-ink)] shadow-hard"
        >
          cf
        </span>
        <article className="team-bubble flex-1" data-tone="summary" style={{ "--role": "var(--ink)" } as CSSProperties}>
          <header className="team-bubble__head">
            <span className="text-[13.5px] font-bold text-ink">{tl.system}</span>
            <span className="text-[12.5px] text-ink-3">{tl.summaryTitle}</span>
            <time className="ml-auto font-mono text-[11px] text-ink-3" dateTime={a.createdAt}>
              {timeOf(a.createdAt)}
            </time>
          </header>
          <MarkdownBody body={a.body} t={t} />
        </article>
      </div>
    );
  }

  const tokens = node ? totalTokens(node) : 0;
  const showRound = run.teamSnapshot.roles.some((r) => r.kind === "qa") && (kind === "developer" || kind === "qa");

  return (
    <div className="flex gap-3">
      <RolePlate kind={kind} size="md" />
      <article className="team-bubble flex-1" style={{ "--role": ROLE_TONE[kind].fill } as CSSProperties}>
        <header className="team-bubble__head">
          <span className="text-[13.5px] font-bold text-ink">{roleLabel(role, kind, t)}</span>
          <span className="text-[12.5px] text-ink-3">{t.team.artifactKinds[a.kind]}</span>
          {showRound && <span className="team-chip">{fill(t.team.round, { n: a.round })}</span>}
          {a.verdict && (
            <StatusPill
              status={a.verdict === "pass" ? "done" : "error"}
              variant="solid"
              icon={a.verdict === "pass" ? <IconCheck size={12} /> : <IconClose size={12} />}
            >
              QA · {t.team.verdict[a.verdict]}
            </StatusPill>
          )}
          {a.kind === "spec" && a.approved && (
            <StatusPill status="done" icon={<IconCheck size={12} />}>
              {tl.approved}
            </StatusPill>
          )}
          <time className="ml-auto font-mono text-[11px] text-ink-3" dateTime={a.createdAt}>
            {timeOf(a.createdAt)}
          </time>
        </header>
        <MarkdownBody body={a.body} t={t} />
        {(a.costUsd != null || tokens > 0 || a.commitSha) && (
          <footer className="team-bubble__foot">
            {a.costUsd != null && (
              <span className="team-chip" title={t.taskDetail.costReported}>
                <IconCoin size={12} />${a.costUsd.toFixed(2)}
              </span>
            )}
            {tokens > 0 && (
              <span className="team-chip">
                {formatTokens(tokens)} {tl.tokens}
              </span>
            )}
            {node?.model && <span className="team-chip">{node.model}</span>}
            {a.commitSha && (
              <span className="team-chip !bg-ink !text-[var(--on-ink)]" title={a.commitSha}>
                <IconBranch size={12} />
                {tl.commit} {a.commitSha.slice(0, 7)}
              </span>
            )}
          </footer>
        )}
      </article>
    </div>
  );
}

function LiveBubble({ kind, name, label }: { kind: NonNullable<TeamArtifact["roleKind"]>; name: string; label: string }) {
  return (
    <div className="flex gap-3" aria-live="polite">
      <RolePlate kind={kind} size="md" />
      <div
        className="team-bubble flex items-center gap-3 px-4 py-3"
        data-tone="live"
        style={{ "--role": ROLE_TONE[kind].fill } as CSSProperties}
      >
        <span className="text-[13.5px] font-bold text-ink">{name}</span>
        <span className="text-[13px] text-ink-2">{label}</span>
        <span className="flex gap-1" aria-hidden>
          <span className="animate-dot-1 h-1.5 w-1.5 rounded-full bg-ink-3" />
          <span className="animate-dot-2 h-1.5 w-1.5 rounded-full bg-ink-3" />
          <span className="animate-dot-3 h-1.5 w-1.5 rounded-full bg-ink-3" />
        </span>
      </div>
    </div>
  );
}

/**
 * The bubble header already names the output and the QA pill carries the verdict,
 * so drop a leading "## Brief"-style heading and the `VERDICT:` line from the body.
 */
export function displayBody(body: string): string {
  return body
    .replace(/^\s*#{1,2}\s+[^\n]*\n+/, "")
    .replace(/^[ \t]*\**VERDICT:\s*(PASS|FAIL)\**[ \t]*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Markdown body clamped to ~15rem; a hard-edged "show all" strip covers the cut. */
function MarkdownBody({ body, t }: { body: string; t: Translations }) {
  const tl = t.team.timeline;
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const text = useMemo(() => displayBody(body), [body]);

  // Re-measure on resize too: the drawer settles its width after the first paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 4);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [text, open]);

  const toggle = (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className="ui-focus rounded-[6px] text-[12px] font-semibold text-[var(--cobalt-text)] underline underline-offset-2"
    >
      {open ? tl.showLess : tl.showMore}
    </button>
  );

  return (
    <div className="relative">
      <div
        ref={ref}
        className="team-bubble__body comment-markdown text-[13.5px] leading-relaxed text-ink"
        data-clamped={!open || undefined}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
      {overflows && !open && <div className="team-bubble__more">{toggle}</div>}
      {open && <div className="px-[1.15rem] pb-2.5">{toggle}</div>}
    </div>
  );
}
