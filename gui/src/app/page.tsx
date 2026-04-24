"use client";

import Link from "next/link";
import { useTranslation } from "@/hooks/useTranslation";

const stages = [
  { label: "TODO",   color: "bg-zinc-700",   text: "text-zinc-300" },
  { label: "DOING",  color: "bg-violet-600",  text: "text-violet-100" },
  { label: "REVIEW", color: "bg-indigo-600",  text: "text-indigo-100" },
  { label: "DONE",   color: "bg-emerald-600", text: "text-emerald-100" },
];

export default function LandingPage() {
  const t = useTranslation();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[600px] w-[600px] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      {/* Logo */}
      <div className="relative mb-8 flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <defs>
            <linearGradient id="land-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#7c3aed" />
              <stop offset="1" stopColor="#4338ca" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx="12" fill="url(#land-grad)" />
          <path d="M9 16L15 20L9 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 16L25 20L19 24" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="32" cy="20" r="2.5" fill="rgba(255,255,255,0.45)" />
        </svg>
        <span className="text-3xl font-bold tracking-tight text-zinc-100">
          ClauFlow
        </span>
      </div>

      {/* Tagline */}
      <p className="relative mb-2 max-w-md text-center text-lg text-zinc-400">
        {t.landing.tagline}
      </p>
      <p className="relative mb-12 max-w-sm text-center text-sm text-zinc-600">
        {t.landing.subtitle}
      </p>

      {/* Flow stages */}
      <div className="relative mb-12 flex items-center gap-2">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className={`rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide ${s.color} ${s.text}`}>
              {s.label}
            </span>
            {i < stages.length - 1 && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 8h8M9 5l3 3-3 3" stroke="#52525b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* CTA */}
      <Link
        href="/board"
        className="relative inline-flex items-center gap-2 rounded-xl bg-violet-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 transition-all hover:bg-violet-500 hover:shadow-violet-800/50 active:scale-95"
      >
        {t.landing.cta}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 8h10M9 5l3 3-3 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
