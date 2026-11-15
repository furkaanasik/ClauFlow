"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { AppShell } from "@/components/Shell/AppShell";
import { PRDetailDrawer } from "@/components/Github/PRDetailDrawer";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tile } from "@/components/ui/Panel";
import { SectionPill, StatusPill } from "@/components/ui/Pills";
import { Segmented } from "@/components/ui/Segmented";
import {
  IconArrowUpRight,
  IconBoard,
  IconCheck,
  IconClose,
  IconGear,
  IconGithub,
  IconPR,
  IconRetry,
} from "@/components/ui/icons";
import { githubApi, type PRListItem } from "@/lib/api";
import { PR_STATE_STYLES, prState, type PRState } from "@/lib/githubConstants";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";

type Filter = "ALL" | PRState;

function useProjectQuerySync(projectId: string | null) {
  useEffect(() => {
    if (!projectId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("projectId") === projectId) return;
    params.set("projectId", projectId);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [projectId]);
}

function GithubPRsContent() {
  const t = useTranslation();
  const tp = t.prs;
  const projectId = useBoardStore((s) => s.selectedProjectId);
  const projectsLoaded = useBoardStore((s) => s.projects.length > 0);
  const project = useBoardStore((s) => s.projects.find((p) => p.id === s.selectedProjectId) ?? null);
  const openProjectDetail = useBoardStore((s) => s.openProjectDetail);
  useProjectQuerySync(projectId);

  const [prs, setPrs] = useState<PRListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPR, setSelectedPR] = useState<PRListItem | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  const fetchPrs = useCallback(() => {
    if (!projectId) {
      setLoading(!projectsLoaded);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    githubApi.listPRs(projectId)
      .then((data) => {
        setPrs(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setPrs([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [projectId, projectsLoaded]);

  useEffect(() => {
    fetchPrs();
  }, [fetchPrs]);

  const counts = useMemo(() => ({
    OPEN: prs.filter((p) => prState(p.state) === "OPEN").length,
    MERGED: prs.filter((p) => prState(p.state) === "MERGED").length,
    CLOSED: prs.filter((p) => prState(p.state) === "CLOSED").length,
  }), [prs]);

  const visible = filter === "ALL" ? prs : prs.filter((p) => prState(p.state) === filter);
  const ok = !loading && !error && projectId;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-8 pb-16 pt-8">
      {/* Page head */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <SectionPill icon={<IconGithub size={13} />}>{tp.eyebrow}</SectionPill>
          <h1 className="t-display mt-3 text-[34px] leading-[1.05] text-ink">{tp.title}</h1>
          <p className="mt-2 max-w-xl text-[14.5px] text-ink-2">{tp.subtitle}</p>
        </div>
        {projectId && (
          <Button variant="secondary" icon={<IconRetry size={14} />} onClick={fetchPrs} loading={loading}>
            {tp.refresh}
          </Button>
        )}
      </header>

      {ok && (
        <section aria-label={tp.summary} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Tile label={tp.state.OPEN} value={counts.OPEN} accent="var(--cobalt)" icon={<IconPR size={15} />} hint={tp.openHint} />
          <Tile label={tp.state.MERGED} value={counts.MERGED} accent="var(--green)" icon={<IconCheck size={15} />} hint={tp.mergedHint} />
          <Tile label={tp.state.CLOSED} value={counts.CLOSED} accent="var(--red)" icon={<IconClose size={15} />} hint={tp.closedHint} />
        </section>
      )}

      {loading && (
        <div className="flex flex-col gap-3" aria-busy aria-label={tp.loading}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ui-hatch h-[76px] rounded-[14px] border-2 border-dashed border-hair" />
          ))}
        </div>
      )}

      {!loading && !projectId && (
        <StateCard
          art={<EmptyTrayArt />}
          title={tp.noProjectTitle}
          body={tp.noProject}
          actions={
            <Link href="/board" className="ui-btn ui-btn--secondary ui-btn--md ui-focus">
              <IconBoard size={15} />
              {tp.backToBoard}
            </Link>
          }
        />
      )}

      {!loading && error && projectId && (
        /remote/i.test(error) ? (
          <StateCard
            tone="warn"
            art={<UnpluggedArt />}
            title={tp.noRemoteTitle}
            body={tp.noRemoteBody.replace("{project}", project?.name ?? "")}
            detail={error}
            actions={
              <>
                <Button variant="primary" icon={<IconGear size={15} />} onClick={() => openProjectDetail(projectId)}>
                  {tp.openProjectSettings}
                </Button>
                <Button variant="secondary" icon={<IconRetry size={15} />} onClick={fetchPrs}>
                  {tp.retry}
                </Button>
              </>
            }
          />
        ) : (
          <StateCard
            tone="error"
            art={<UnpluggedArt broken />}
            title={tp.errorTitle}
            body={tp.errorBody}
            detail={error}
            actions={
              <Button variant="secondary" icon={<IconRetry size={15} />} onClick={fetchPrs}>
                {tp.retry}
              </Button>
            }
          />
        )
      )}

      {ok && prs.length === 0 && (
        <StateCard
          art={<EmptyTrayArt />}
          title={tp.emptyTitle}
          body={tp.emptyBody}
          actions={
            <Link href={`/board?projectId=${projectId}`} className="ui-btn ui-btn--secondary ui-btn--md ui-focus">
              <IconBoard size={15} />
              {tp.backToBoard}
            </Link>
          }
        />
      )}

      {ok && prs.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented<Filter>
              label={tp.filterLabel}
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "ALL", label: tp.filterAll, count: prs.length },
                { value: "OPEN", label: tp.state.OPEN, count: counts.OPEN },
                { value: "MERGED", label: tp.state.MERGED, count: counts.MERGED },
                { value: "CLOSED", label: tp.state.CLOSED, count: counts.CLOSED },
              ]}
            />
            <span className="font-mono text-[12px] text-ink-3">{tp.showing(visible.length, prs.length)}</span>
          </div>

          {visible.length === 0 ? (
            <div className="ui-hatch rounded-[14px] border-2 border-dashed border-line px-6 py-10 text-center text-[13px] text-ink-2">
              {tp.filterEmpty}
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {visible.map((pr) => {
                const st = prState(pr.state);
                const style = PR_STATE_STYLES[st];
                return (
                  <li key={pr.number}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPR(pr)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedPR(pr);
                        }
                      }}
                      className="pr-row ui-focus"
                      style={{ "--pr": style.fill } as CSSProperties}
                    >
                      <span className="pr-row__num">#{pr.number}</span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-[15.5px] font-bold leading-snug text-ink">{pr.title}</span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
                          <Avatar name={pr.author?.login ?? "?"} size="xs" />
                          <span className="font-semibold text-ink-2">@{pr.author?.login ?? tp.unknownAuthor}</span>
                          {pr.repository && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="font-mono">{pr.repository.nameWithOwner}</span>
                            </>
                          )}
                          <span aria-hidden>·</span>
                          <span className="font-mono tabular-nums">{formatDate(pr.createdAt)}</span>
                        </span>
                      </div>
                      <StatusPill status={style.status} icon={<IconPR size={12} />} className="shrink-0">
                        {tp.state[st]}
                      </StatusPill>
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-focus shrink-0"
                        title={tp.openOnGithub}
                        aria-label={tp.openOnGithub}
                      >
                        <IconArrowUpRight size={14} />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {selectedPR && projectId && (
        <PRDetailDrawer
          pr={selectedPR}
          projectId={projectId}
          onClose={() => setSelectedPR(null)}
          onMerged={() => { setSelectedPR(null); fetchPrs(); }}
        />
      )}
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Designed empty / error state: printed illustration, title, body, actions. */
function StateCard({
  art,
  title,
  body,
  detail,
  actions,
  tone,
}: {
  art: ReactNode;
  title: string;
  body: string;
  detail?: string;
  actions?: ReactNode;
  tone?: "warn" | "error";
}) {
  return (
    <section
      className="ui-panel ui-panel--raised relative grid items-center gap-8 overflow-hidden px-8 py-10 md:grid-cols-[260px_1fr] md:gap-x-16"
      data-tone={tone}
    >
      <div aria-hidden className="ui-hatch absolute inset-y-0 left-0 hidden w-[324px] border-r-2 border-dashed border-hair md:block" />
      <div className="relative mx-auto w-full max-w-[260px]">{art}</div>
      <div className="relative flex min-w-0 flex-col items-start gap-3">
        <h2 className="t-display text-[26px] leading-tight text-ink">{title}</h2>
        <p className="max-w-[520px] text-[14px] leading-relaxed text-ink-2">{body}</p>
        {detail && (
          <code
            className="max-w-full truncate rounded-[8px] border-[1.5px] border-line bg-sunken px-2.5 py-1 font-mono text-[11.5px]"
            style={{ color: tone === "error" ? "var(--red-text)" : tone === "warn" ? "var(--orange-text)" : "var(--ink-2)" }}
            title={detail}
          >
            {detail}
          </code>
        )}
        {actions && <div className="mt-2 flex flex-wrap gap-2.5">{actions}</div>}
      </div>
    </section>
  );
}

/** Repo plate and GitHub plate with the cable pulled apart. */
function UnpluggedArt({ broken = false }: { broken?: boolean }) {
  return (
    <svg viewBox="0 0 260 150" className="h-auto w-full" aria-hidden="true" focusable="false">
      {/* repo plate */}
      <rect x="14" y="40" width="78" height="70" rx="12" fill="var(--shadow-ink)" transform="translate(4 4)" />
      <rect x="14" y="40" width="78" height="70" rx="12" fill="var(--panel)" stroke="var(--line)" strokeWidth="2.5" />
      <rect x="14" y="40" width="78" height="14" rx="6" fill="var(--mustard)" stroke="var(--line)" strokeWidth="2.5" />
      <path d="M34 72v22M34 78c0 8 18 4 18 14M34 72a4 4 0 1 0 0-.01M52 96a4 4 0 1 0 0-.01" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="72" cy="80" r="3" fill="var(--ink-3)" />
      <circle cx="72" cy="92" r="3" fill="var(--ink-3)" />
      {/* github plate */}
      <rect x="168" y="40" width="78" height="70" rx="12" fill="var(--shadow-ink)" transform="translate(4 4)" />
      <rect x="168" y="40" width="78" height="70" rx="12" fill="var(--panel)" stroke="var(--line)" strokeWidth="2.5" />
      <rect x="168" y="40" width="78" height="14" rx="6" fill="var(--cobalt)" stroke="var(--line)" strokeWidth="2.5" />
      <circle cx="207" cy="84" r="17" fill="var(--sunken)" stroke="var(--line)" strokeWidth="2.5" />
      <path d="M199 80c2-5 14-5 16 0M200 88c3 4 11 4 14 0" fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      {/* cable from repo + plug */}
      <path d="M92 76 C106 76 104 62 116 62" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <rect x="114" y="54" width="14" height="16" rx="3" fill="var(--panel)" stroke="var(--line)" strokeWidth="2.5" />
      <path d="M128 58h6M128 66h6" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      {/* socket cable from github */}
      <path d="M168 76 C154 76 156 92 146 92" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <rect x="134" y="84" width="14" height="16" rx="3" fill="var(--panel)" stroke="var(--line)" strokeWidth="2.5" />
      <circle cx="138" cy="92" r="1.6" fill="var(--ink)" />
      <circle cx="144" cy="92" r="1.6" fill="var(--ink)" />
      {/* spark / gap marker */}
      <circle cx="131" cy="26" r="14" fill={broken ? "var(--red)" : "var(--orange)"} stroke="var(--line)" strokeWidth="2.5" />
      <path d="M131 18v10M131 33v.5" stroke="var(--on-orange)" strokeWidth="3" strokeLinecap="round" />
      <path d="M118 76l-6 4M146 78l6-3M131 72v-6" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />
      <path d="M10 132h240" stroke="var(--hair)" strokeWidth="2" strokeDasharray="6 6" />
    </svg>
  );
}

/** Empty in-tray with a single PR slip floating above it. */
function EmptyTrayArt() {
  return (
    <svg viewBox="0 0 260 150" className="h-auto w-full" aria-hidden="true" focusable="false">
      <rect x="92" y="18" width="76" height="52" rx="8" fill="var(--shadow-ink)" transform="translate(4 4) rotate(-6 130 44)" />
      <g transform="rotate(-6 130 44)">
        <rect x="92" y="18" width="76" height="52" rx="8" fill="var(--panel)" stroke="var(--line)" strokeWidth="2.5" />
        <rect x="102" y="28" width="26" height="12" rx="6" fill="var(--cobalt)" stroke="var(--line)" strokeWidth="2" />
        <path d="M102 50h52M102 59h36" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <path d="M40 92h180l-14 36H54z" fill="var(--shadow-ink)" transform="translate(4 4)" />
      <path d="M40 92h180l-14 36H54z" fill="var(--sunken)" stroke="var(--line)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M40 92h56l8 12h52l8-12h56" fill="none" stroke="var(--line)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M118 84v-6M130 86v-8M142 84v-6" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
    </svg>
  );
}

export default function GithubPRsPage() {
  return (
    <AppShell section="prs">
      <GithubPRsContent />
    </AppShell>
  );
}
