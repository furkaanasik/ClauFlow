"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PrereqItem } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";

type State =
  | { kind: "loading" }
  | { kind: "ok"; items: PrereqItem[] }
  | { kind: "error"; message: string };

export function PrereqIndicator() {
  const t = useTranslation().prereqs;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const data = await api.getPrereqs();
      setState({ kind: "ok", items: data.items });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "error" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!popRef.current) return;
      if (!popRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const missing =
    state.kind === "ok" ? state.items.filter((i) => !i.found).length : 0;
  const allOk = state.kind === "ok" && missing === 0;
  const dotColor =
    state.kind === "loading"
      ? "bg-[var(--text-faint)]"
      : state.kind === "error"
      ? "bg-[var(--status-error)]"
      : allOk
      ? "bg-[var(--accent-primary)]"
      : "bg-[var(--status-warning)]";

  const labelText =
    state.kind === "loading"
      ? t.checking
      : state.kind === "error"
      ? t.error
      : allOk
      ? t.allGood
      : missing === 1
      ? t.missingOne
      : t.missingMany.replace("{n}", String(missing));

  const copy = async (cmd: string, key: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 px-2 text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        title={`${t.title}: ${labelText}`}
      >
        <span className={`h-1.5 w-1.5 ${dotColor}`} />
        <span className="hidden text-[11px] font-mono uppercase tracking-[0.1em] md:inline">
          ENV
        </span>
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute right-0 top-full z-40 mt-2 w-[360px] border border-[var(--border)] bg-[var(--bg-base)] shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {t.title}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {t.rerun}
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {state.kind === "loading" && (
              <div className="px-2 py-3 text-[12px] text-[var(--text-muted)]">{t.checking}</div>
            )}
            {state.kind === "error" && (
              <div className="px-2 py-3 text-[12px] text-[var(--status-error)]">
                {t.error}: {state.message}
              </div>
            )}
            {state.kind === "ok" && state.items.map((item) => (
              <div
                key={item.name}
                className="border-b border-[var(--border)] px-2 py-2 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 ${
                        item.found ? "bg-[var(--accent-primary)]" : "bg-[var(--status-error)]"
                      }`}
                    />
                    <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                      {item.name}
                    </span>
                    <span className="truncate text-[11px] text-[var(--text-muted)]">
                      {item.found ? item.version ?? t.found : t.missing}
                    </span>
                  </div>
                  <a
                    href={item.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-primary)]"
                  >
                    {t.docs} ↗
                  </a>
                </div>
                {!item.found && (
                  <div className="mt-2 flex items-stretch gap-1">
                    <code className="flex-1 overflow-x-auto whitespace-nowrap border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
                      {item.installCmd}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copy(item.installCmd, item.name)}
                      className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11px] text-[var(--text-muted)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      {copied === item.name ? t.copied : t.copy}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
