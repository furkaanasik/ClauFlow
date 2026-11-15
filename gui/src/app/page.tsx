"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { FactoryHero } from "@/components/Landing/FactoryHero";
import { IconButton } from "@/components/ui/Button";
import { SectionPill } from "@/components/ui/Pills";
import { IconArrowUpRight, IconChevronRight, IconGithub, IconMoon, IconSun } from "@/components/ui/icons";
import { useTheme } from "@/hooks/useTheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useBoardStore } from "@/store/boardStore";

const REPO = "https://github.com/furkaanasik/ClauFlow";
/** Set once the landing has been shown; later visits to `/` go straight to the board. */
const VISITED_KEY = "clauflow.visited";

export default function LandingPage() {
  const t = useTranslation();
  const L = t.landing;
  const router = useRouter();
  // zincir F0.5 (plan §5.0, Z24): decide before the landing renders. While
  // "pending" nothing heavy mounts, so a visitor who is redirected to the board
  // never mounts (and immediately unmounts) the hero's R3F <Canvas>. The server
  // and the first client render agree on "pending" (no localStorage on the server).
  const [gate, setGate] = useState<"pending" | "show">("pending");

  // First visit shows the landing and remembers it; afterwards `/` opens the
  // board. `/?landing=1` (the logo links) always shows the landing.
  useLayoutEffect(() => {
    try {
      const forced = new URLSearchParams(window.location.search).get("landing") === "1";
      if (!forced && localStorage.getItem(VISITED_KEY) === "1") {
        router.replace("/board");
        return;
      }
      localStorage.setItem(VISITED_KEY, "1");
    } catch {
      /* storage blocked: always show the landing */
    }
    setGate("show");
  }, [router]);

  if (gate === "pending") return <main className="min-h-screen" aria-busy="true" />;

  return (
    <main className="relative min-h-screen text-ink">
      <LandingNav />

      <FactoryHero>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:gap-12">
          <div>
            <SectionPill size="sm">{L.eyebrow}</SectionPill>
            <h1 className="t-display mt-4 text-[clamp(2.3rem,4.6vw,4.1rem)] leading-[0.98]">
              <span className="block">{L.titleA}</span>
              <span className="block">
                <span className="landing-mark">{L.titleB}</span>
              </span>
              <span className="block">{L.titleC}</span>
            </h1>
          </div>
          <div className="lg:pb-1">
            <p className="max-w-[500px] text-[15px] leading-relaxed text-ink-2 md:text-[16px]">
              <strong className="font-semibold text-ink">{L.tagline}</strong> {L.subtitle}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href="/board" className="ui-btn ui-btn--primary ui-btn--lg ui-focus">
                {L.cta}
                <IconChevronRight size={18} />
              </Link>
              <Link
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn ui-btn--secondary ui-btn--lg ui-focus"
              >
                <IconGithub size={18} />
                {L.ctaSecondary}
              </Link>
            </div>
          </div>
        </div>
      </FactoryHero>

      <HowItWorks />
      <Closing />
      <Footer />
    </main>
  );
}

/* ─── nav ──────────────────────────────────────────────────────────────── */

function LandingNav() {
  const t = useTranslation();
  const { isNight, toggleTheme } = useTheme();
  const lang = useBoardStore((s) => s.lang);
  const setLang = useBoardStore((s) => s.setLang);

  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 pt-5 md:px-12 md:pt-7">
        <Link href="/?landing=1" className="ui-focus flex items-center gap-2.5 rounded-[10px]">
          <Monogram />
          <span className="text-[17px] font-extrabold tracking-tight">ClauFlow</span>
        </Link>
        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-focus hidden h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-[14px] font-semibold text-ink-2 transition hover:bg-hair hover:text-ink sm:inline-flex"
          >
            <IconGithub size={16} />
            {t.landing.navGithub}
          </Link>
          <button
            type="button"
            onClick={() => setLang(lang === "tr" ? "en" : "tr")}
            aria-label={t.shell.switchLang}
            title={t.shell.switchLang}
            className="ui-focus grid h-9 min-w-9 place-items-center rounded-[8px] px-1.5 font-mono text-[12px] font-bold text-ink-2 transition hover:bg-hair hover:text-ink"
          >
            {lang === "tr" ? "TR" : "EN"}
          </button>
          <IconButton
            label={isNight ? t.header.themeToLight : t.header.themeToDark}
            variant="ghost"
            size="md"
            onClick={toggleTheme}
          >
            {isNight ? <IconSun size={17} /> : <IconMoon size={17} />}
          </IconButton>
          <Link href="/board" className="ui-btn ui-btn--primary ui-btn--md ui-focus ml-1">
            {t.landing.navBoard}
            <IconChevronRight size={16} />
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Monogram() {
  return (
    <span
      aria-hidden
      className="relative grid h-9 w-9 flex-none place-items-center rounded-[10px] border-2 border-line bg-mustard font-mono text-[14px] font-extrabold leading-none text-[var(--on-mustard)] shadow-[2px_2px_0_var(--shadow-ink)]"
    >
      cf
      <span className="absolute -right-[3px] -top-[3px] h-2.5 w-2.5 rounded-full border-2 border-line bg-orange" />
    </span>
  );
}

/* ─── how it works ─────────────────────────────────────────────────────── */

const STEP_TONE = {
  drag: { fill: "var(--orange)", on: "var(--on-orange)" },
  comment: { fill: "var(--mustard)", on: "var(--on-mustard)" },
  merge: { fill: "var(--green)", on: "var(--on-green)" },
} as const;

function HowItWorks() {
  const t = useTranslation();
  const H = t.landing.how;
  const steps = (["drag", "comment", "merge"] as const).map((k) => ({ k, ...H.steps[k] }));

  return (
    <section className="relative z-10 mx-auto max-w-7xl px-6 pb-8 pt-24 md:px-12 md:pt-32">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <SectionPill size="sm">{H.eyebrow}</SectionPill>
          <h2 className="t-display mt-4 text-[clamp(2rem,4vw,3.25rem)] leading-[1.02]">
            {H.title}
            <br />
            <span className="text-ink-3">{H.titleAccent}</span>
          </h2>
        </div>
        <p className="max-w-sm text-[15px] leading-relaxed text-ink-2">{H.body}</p>
      </div>

      <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.k} className="ui-panel ui-panel--raised flex flex-col overflow-hidden">
            <div className="ui-hatch relative grid h-36 place-items-center border-b-2 border-line bg-sunken">
              <span
                className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-[10px] border-2 border-line font-mono text-[15px] font-extrabold"
                style={{ background: STEP_TONE[s.k].fill, color: STEP_TONE[s.k].on, boxShadow: "2px 2px 0 var(--shadow-ink)" }}
              >
                {i + 1}
              </span>
              <StepArt kind={s.k} />
            </div>
            <div className="flex flex-1 flex-col gap-2 p-5">
              <span
                className="ui-pill ui-pill--sm self-start font-mono font-bold uppercase tracking-[0.08em]"
                style={{ background: STEP_TONE[s.k].fill, color: STEP_TONE[s.k].on } as CSSProperties}
              >
                {s.verb}
              </span>
              <h3 className="t-h2 mt-1 !text-[1.3rem]">{s.title}</h3>
              <p className="text-[14px] leading-relaxed text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const ART = { stroke: "var(--line)", strokeWidth: 2.5, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function StepArt({ kind }: { kind: "drag" | "comment" | "merge" }) {
  let body: ReactNode;
  if (kind === "drag") {
    body = (
      <>
        <rect x="8" y="22" width="50" height="62" rx="8" fill="var(--panel)" {...ART} strokeDasharray="5 5" />
        <rect x="102" y="22" width="50" height="62" rx="8" fill="var(--panel)" {...ART} />
        <rect x="106" y="30" width="42" height="26" rx="5" fill="var(--panel)" {...ART} style={{ fill: "color-mix(in srgb, var(--orange) 22%, var(--panel))" }} />
        <rect x="58" y="18" width="46" height="30" rx="6" fill="var(--panel)" {...ART} transform="rotate(-6 81 33)" />
        <path d="M66 28h22M66 36h14" {...ART} transform="rotate(-6 81 33)" />
        <path d="M60 66 h34 m-8 -7 l8 7 l-8 7" fill="none" {...ART} stroke="var(--orange-text)" strokeWidth={3} />
        <text x="33" y="100" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="var(--font-mono)" fill="var(--ink-3)">TODO</text>
        <text x="127" y="100" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="var(--font-mono)" fill="var(--orange-text)">DOING</text>
      </>
    );
  } else if (kind === "comment") {
    body = (
      <>
        <rect x="18" y="14" width="88" height="50" rx="10" fill="var(--panel)" {...ART} />
        <path d="M38 64 l-6 14 l18 -14" fill="var(--panel)" {...ART} />
        <path d="M32 30h58M32 42h40" {...ART} />
        <circle cx="122" cy="72" r="18" fill="var(--mustard)" {...ART} />
        <path d="M114 72 a8 8 0 1 1 3 6" fill="none" {...ART} />
        <path d="M113 66 v7 h7" fill="none" {...ART} />
        <path d="M36 96 h88" {...ART} strokeDasharray="4 6" stroke="var(--ink-3)" />
      </>
    );
  } else {
    body = (
      <>
        <path d="M24 92 V22" {...ART} strokeWidth={4} stroke="var(--ink-2)" />
        <path d="M24 70 C24 50 70 52 70 34 V22" fill="none" {...ART} strokeWidth={4} stroke="var(--green-text)" />
        <circle cx="24" cy="92" r="7" fill="var(--panel)" {...ART} />
        <circle cx="70" cy="34" r="7" fill="var(--green)" {...ART} />
        <circle cx="24" cy="22" r="7" fill="var(--panel)" {...ART} />
        <g transform="translate(92 34) rotate(-8)">
          <rect width="50" height="34" rx="6" fill="var(--panel)" {...ART} stroke="var(--red-text)" strokeWidth={3} />
          <text x="25" y="24" textAnchor="middle" fontSize="18" fontWeight="900" fill="var(--red-text)">PR</text>
        </g>
        <path d="M100 84 l8 8 l16 -18" fill="none" {...ART} stroke="var(--green-text)" strokeWidth={4} />
      </>
    );
  }
  return (
    <svg viewBox="0 0 160 108" className="h-28 w-auto" aria-hidden>
      {body}
    </svg>
  );
}

/* ─── closing + footer ─────────────────────────────────────────────────── */

function Closing() {
  const t = useTranslation();
  const C = t.landing.closing;
  return (
    <section className="relative z-10 mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-28">
      <div className="ui-panel relative flex flex-wrap items-end justify-between gap-8 overflow-hidden bg-mustard p-8 text-[var(--on-mustard)] shadow-[6px_6px_0_var(--shadow-ink)] md:p-12">
        <div>
          <span className="t-label !text-[var(--on-mustard)] opacity-70">{C.eyebrow}</span>
          <h2 className="t-display mt-3 text-[clamp(1.9rem,4vw,3.25rem)] leading-[1.02]">
            {C.title}
            <br />
            {C.titleAccent}
          </h2>
        </div>
        <Link href="/board" className="ui-btn ui-btn--secondary ui-btn--lg ui-focus">
          {C.cta}
          <IconArrowUpRight size={18} />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  const t = useTranslation();
  return (
    <footer className="relative z-10 border-t-2 border-hair">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-6 md:px-12">
        <span className="font-mono text-[12px] font-semibold text-ink-3">{t.landing.footer.tagline}</span>
        <span className="font-mono text-[12px] text-ink-3">{t.landing.footer.stack}</span>
        <div className="flex items-center gap-5 text-[13px] font-semibold text-ink-2">
          <Link href="/board" className="ui-focus rounded hover:text-ink">
            {t.landing.navBoard}
          </Link>
          <Link href={REPO} target="_blank" rel="noopener noreferrer" className="ui-focus rounded hover:text-ink">
            {t.landing.navGithub}
          </Link>
        </div>
      </div>
    </footer>
  );
}
