"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

const STAGES = ["TODO", "DOING", "REVIEW", "DONE"] as const;
const STAGE_NUMS = ["01", "02", "03", "04"];
const STAGE_NOTES = ["queued", "agent writes", "human reads", "merged"];

const DEMO_TITLE = "Add user authentication";
const DEMO_ID = "CLF-87";

const STAGE_INTERVAL = 2600;

export default function LandingPage() {
  const t = useTranslation();
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const id = window.setInterval(
      () => setStage((s) => (s + 1) % STAGES.length),
      STAGE_INTERVAL,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* ─── Top bar ───────────────────────────────────────────────────── */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 pt-6 md:px-12 md:pt-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Monogram />
          <span className="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
            ClauFlow
          </span>
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="https://github.com/furkaanasik/ClauFlow"
            target="_blank"
            rel="noopener noreferrer"
            className="t-label hidden transition hover:text-[var(--text-primary)] sm:inline"
          >
            github ↗
          </Link>
          <Link
            href="/board"
            className="btn-ink inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em]"
          >
            <span>open board</span>
            <span aria-hidden>→</span>
          </Link>
        </nav>
      </header>

      {/* ─── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-16 md:px-12 md:pt-24">
        <div className="grid gap-10 md:grid-cols-12 md:gap-10 lg:gap-14">
          {/* Left — pitch */}
          <div className="md:col-span-6 lg:col-span-5">
            <span className="t-label">§ agentic kanban · v 1.0</span>
            <h1 className="t-display mt-6 text-[clamp(2.75rem,6.8vw,5.75rem)]">
              Drag a task.
              <br />
              <span className="italic text-[var(--text-secondary)]">
                The agent
              </span>
              <br />
              ships the PR.
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--text-secondary)]">
              {t.landing.tagline}
            </p>
            <p className="mt-2 max-w-md text-sm text-[var(--text-muted)]">
              {t.landing.subtitle}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-5">
              <Link
                href="/board"
                className="btn-ink inline-flex items-center gap-3 px-6 py-3 text-sm uppercase tracking-[0.18em]"
              >
                <span>{t.landing.cta}</span>
                <span aria-hidden className="font-mono text-base leading-none">
                  ↗
                </span>
              </Link>
              <Link
                href="https://github.com/furkaanasik/ClauFlow"
                target="_blank"
                rel="noopener noreferrer"
                className="t-label transition hover:text-[var(--text-primary)]"
              >
                read the source · github
              </Link>
            </div>

            {/* Quick stats row */}
            <dl className="mt-10 grid grid-cols-3 gap-px border border-[var(--border)] bg-[var(--border)]">
              <Stat k="next" v="15" />
              <Stat k="agent" v="opus 4.7" />
              <Stat k="vcs" v="git · gh" />
            </dl>
          </div>

          {/* Right — animated mini kanban */}
          <div className="md:col-span-6 lg:col-span-7">
            <MiniKanban activeStage={stage} />
          </div>
        </div>
      </section>

      {/* ─── How it works ──────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mt-32 max-w-7xl px-6 md:mt-40 md:px-12">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="t-label mb-3">§ how it works</p>
            <h2 className="t-display text-3xl md:text-5xl">
              three motions.
              <br />
              <span className="italic text-[var(--text-secondary)]">
                no scripts.
              </span>
            </h2>
          </div>
          <p className="max-w-sm text-sm text-[var(--text-muted)]">
            Drag, comment, merge. Everything between is the agent — branching,
            writing, pushing, opening pull requests.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
          <Feature
            num="i."
            verb="drag"
            title="dispatch the agent"
            body="Move a card from TODO to DOING. Claude branches off main, runs your analysis, commits, pushes, opens a PR."
            ink="var(--accent-primary)"
          />
          <Feature
            num="ii."
            verb="comment"
            title="iterate on the same branch"
            body="Leave a review comment. The agent re-runs against the same branch and pushes new commits — no churn."
            ink="var(--status-review)"
          />
          <Feature
            num="iii."
            verb="merge"
            title="close the loop"
            body="Drop the card in DONE. ClauFlow calls gh pr merge and your task is shipped to main."
            ink="var(--status-done)"
          />
        </div>
      </section>

      {/* ─── Closing ───────────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto mt-32 max-w-7xl border-t border-[var(--border)] px-6 pt-16 md:px-12">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <h3 className="t-display text-3xl md:text-5xl">
            built for tonight,
            <br />
            <span className="italic text-[var(--text-secondary)]">
              not the roadmap.
            </span>
          </h3>
          <Link
            href="/board"
            className="btn-ink inline-flex items-center gap-3 px-6 py-3 text-sm uppercase tracking-[0.18em]"
          >
            <span>open the board</span>
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer className="relative z-10 mt-24 border-t border-[var(--border)] px-6 py-6 md:px-12">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <span className="t-numeral">© ClauFlow · agentic kanban</span>
          <div className="flex items-center gap-6">
            <Link
              href="/board"
              className="t-label transition hover:text-[var(--text-primary)]"
            >
              board
            </Link>
            <Link
              href="https://github.com/furkaanasik/ClauFlow"
              target="_blank"
              rel="noopener noreferrer"
              className="t-label transition hover:text-[var(--text-primary)]"
            >
              github
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Mini kanban — auto-cycles a card across 4 columns                     */
/* ────────────────────────────────────────────────────────────────────── */

function MiniKanban({ activeStage }: { activeStage: number }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--bg-surface)] p-3 md:p-4">
      {/* mini header */}
      <div className="mb-3 flex items-center justify-between border-b border-[var(--border)] pb-2.5">
        <div className="flex items-center gap-3">
          <span className="t-label">§ live demo</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)] sm:inline">
            ws://localhost:3001 · streaming
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--accent-primary)]">
          <span className="h-1 w-1 animate-pulse bg-[var(--accent-primary)]" />
          live
        </span>
      </div>

      {/* columns */}
      <div className="grid grid-cols-4 gap-1.5 md:gap-2">
        {STAGES.map((label, idx) => {
          const isActive = activeStage === idx;
          return (
            <div
              key={label}
              className={`flex h-72 flex-col border bg-[var(--bg-base)] transition-colors duration-500 md:h-80 ${
                isActive
                  ? "border-[var(--accent-primary)]"
                  : "border-[var(--border)]"
              }`}
            >
              <header className="relative flex items-center justify-between border-b border-[var(--border)] px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[9px] tracking-widest text-[var(--text-faint)]">
                    {STAGE_NUMS[idx]}
                  </span>
                  <span
                    className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors ${
                      isActive
                        ? "text-[var(--accent-primary)]"
                        : "text-[var(--text-muted)]"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {isActive && (
                  <span
                    aria-hidden
                    className="h-1 w-1 animate-pulse bg-[var(--accent-primary)]"
                  />
                )}
                {/* scan line on active doing column */}
                {isActive && idx === 1 && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden"
                  >
                    <span className="absolute inset-y-0 left-0 w-1/3 animate-scan bg-[var(--accent-primary)]" />
                  </span>
                )}
              </header>

              {/* card slot */}
              <div className="relative flex-1 p-2">
                {/* placeholder — visible when slot is empty */}
                <div
                  aria-hidden
                  className={`absolute inset-2 flex items-center justify-center border border-dashed border-[var(--border)] transition-opacity duration-500 ${
                    isActive ? "opacity-0" : "opacity-100"
                  }`}
                >
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
                    —
                  </span>
                </div>

                {/* card */}
                <div
                  className={`absolute inset-2 overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] p-2.5 transition-all duration-700 ease-out ${
                    isActive
                      ? "translate-y-0 opacity-100"
                      : "pointer-events-none -translate-y-2 opacity-0"
                  }`}
                  aria-hidden={!isActive}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[2px] bg-[var(--prio-medium)]"
                  />
                  <div className="pl-1.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-faint)]">
                        {DEMO_ID}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--prio-medium)]">
                        p2
                      </span>
                    </div>
                    <h4 className="t-display text-[15px] leading-snug text-[var(--text-primary)]">
                      {DEMO_TITLE}
                    </h4>
                    <div className="mt-2 border-t border-[var(--border)] pt-1.5">
                      <StageStatus idx={idx} />
                    </div>
                  </div>
                </div>
              </div>

              {/* footer note */}
              <footer className="border-t border-[var(--border)] px-2.5 py-1.5">
                <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-faint)]">
                  {STAGE_NOTES[idx]}
                </span>
              </footer>
            </div>
          );
        })}
      </div>

      {/* caption */}
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
          card cycles every {(STAGE_INTERVAL * STAGES.length) / 1000}s
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
          fig. 01
        </span>
      </div>
    </div>
  );
}

function StageStatus({ idx }: { idx: number }) {
  if (idx === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        <span className="h-1 w-1 bg-[var(--text-faint)]" />
        queued
      </span>
    );
  }
  if (idx === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--status-doing)]">
        <span className="flex gap-[2px]">
          <span className="h-[3px] w-[3px] animate-dot-1 bg-[var(--status-doing)]" />
          <span className="h-[3px] w-[3px] animate-dot-2 bg-[var(--status-doing)]" />
          <span className="h-[3px] w-[3px] animate-dot-3 bg-[var(--status-doing)]" />
        </span>
        agent writes
      </span>
    );
  }
  if (idx === 2) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--status-review)]">
        <span className="h-1 w-1 bg-[var(--status-review)]" />
        pr #87 · diff ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--accent-primary)]">
      <span className="h-1 w-1 bg-[var(--accent-primary)]" />
      merged ✓
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Small atoms                                                            */
/* ────────────────────────────────────────────────────────────────────── */

function Feature({
  num,
  verb,
  title,
  body,
  ink,
}: {
  num: string;
  verb: string;
  title: string;
  body: string;
  ink: string;
}) {
  return (
    <article className="group relative flex flex-col gap-4 bg-[var(--bg-surface)] p-6 transition-colors hover:bg-[var(--bg-elevated)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
          {num}
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: ink }}
        >
          {verb}
        </span>
      </div>
      <h3 className="t-display text-2xl leading-tight text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-[var(--text-muted)]">{body}</p>
      <span
        aria-hidden
        className="mt-auto h-px w-12 transition-all duration-500 group-hover:w-full"
        style={{ background: ink }}
      />
    </article>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 bg-[var(--bg-base)] px-3 py-2.5">
      <dt className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-faint)]">
        {k}
      </dt>
      <dd className="font-mono text-[12px] text-[var(--text-primary)]">{v}</dd>
    </div>
  );
}

function Monogram() {
  return (
    <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden border border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-base)]">
      <span className="font-mono text-[12px] font-bold leading-none">cf</span>
      <span className="absolute inset-y-0 right-0 w-[2px] bg-[var(--accent-primary)]" />
    </div>
  );
}
