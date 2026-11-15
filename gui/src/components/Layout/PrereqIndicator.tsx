"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { GithubConnectModal } from "@/components/Auth/GithubConnectModal";
import { api, type PrereqItem } from "@/lib/api";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { Button, IconButton } from "@/components/ui/Button";
import { DotMeter } from "@/components/ui/Meters";
import { IconArrowUpRight, IconCheck, IconClose, IconCopy, IconGithub, IconRetry, IconSpinner } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/overlay";

type State =
  | { kind: "loading" }
  | { kind: "ok"; items: PrereqItem[] }
  | { kind: "error"; message: string };

export function PrereqIndicator() {
  const t = useTranslation().prereqs;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const [connectOpen, setConnectOpen] = useState(false);
  const { status: github, loading: githubLoading, refresh: refreshGithub } = useGithubAuth();

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
  const rerun = () => {
    void load();
    refreshGithub().catch(() => { /* error stored in the slice */ });
  };
  useDismiss(ref, open, () => setOpen(false));

  const total = state.kind === "ok" ? state.items.length : 0;
  const missing = state.kind === "ok" ? state.items.filter((i) => !i.found).length : 0;
  const allOk = state.kind === "ok" && missing === 0;
  const dot =
    state.kind === "loading"
      ? "var(--ink-3)"
      : state.kind === "error"
        ? "var(--red)"
        : allOk
          ? "var(--green)"
          : "var(--orange)";

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
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${t.title}: ${labelText}`}
        title={`${t.title}: ${labelText}`}
        className="ui-focus flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-ink-2 transition hover:bg-hair hover:text-ink"
      >
        <span
          aria-hidden
          className={state.kind === "ok" && !allOk ? "ui-dot ui-dot--live" : "ui-dot"}
          style={{ "--dot": dot } as CSSProperties}
        />
        <span className="hidden font-mono text-[11px] font-bold tracking-[0.1em] md:inline">{t.envLabel}</span>
      </button>

      {open && (
        <div id={panelId} role="dialog" aria-label={t.title} className="ui-menu right-0 top-[calc(100%+10px)] w-[380px] overflow-hidden">
          <header className="flex items-center gap-3 border-b-2 border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-ink">{t.title}</div>
              <div className="mt-1 flex items-center gap-2">
                {state.kind === "ok" ? (
                  <>
                    <DotMeter
                      size="sm"
                      value={total - missing}
                      max={Math.max(total, 1)}
                      color={allOk ? "var(--green)" : "var(--orange)"}
                      label={labelText}
                    />
                    <span className="font-mono text-[11px] font-semibold text-ink-2">
                      {t.readyCount.replace("{n}", String(total - missing)).replace("{total}", String(total))}
                    </span>
                  </>
                ) : (
                  <span className="text-[12px] text-ink-3">{labelText}</span>
                )}
              </div>
            </div>
            <IconButton
              label={t.rerun}
              size="sm"
              variant="secondary"
              loading={state.kind === "loading"}
              onClick={rerun}
            >
              <IconRetry size={14} />
            </IconButton>
          </header>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {state.kind === "loading" && (
              <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-ink-2">
                <IconSpinner size={14} />
                {t.checking}
              </div>
            )}
            {state.kind === "error" && (
              <div role="alert" className="ui-banner ui-banner--error m-1">
                {t.error}: {state.message}
              </div>
            )}
            {state.kind === "ok" &&
              state.items.map((item) => (
                <div key={item.name} className="rounded-[10px] px-2 py-2 transition hover:bg-hair">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] border-2 border-line"
                      style={{
                        background: item.found ? "var(--green)" : "var(--red)",
                        color: item.found ? "var(--on-green)" : "var(--on-red)",
                      }}
                    >
                      {item.found ? <IconCheck size={12} /> : <IconClose size={11} />}
                    </span>
                    <span className="font-mono text-[13px] font-bold text-ink">{item.name}</span>
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[11.5px]"
                      style={{ color: item.found ? "var(--ink-3)" : "var(--red-text)" }}
                    >
                      {item.found ? item.version ?? t.found : t.missing}
                    </span>
                    <a
                      href={item.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ui-focus inline-flex items-center gap-0.5 rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--cobalt-text)] hover:bg-hair"
                    >
                      {t.docs}
                      <IconArrowUpRight size={11} />
                    </a>
                  </div>
                  {!item.found && (
                    <div className="mt-2 flex items-stretch gap-1.5 pl-[2.1rem]">
                      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border-2 border-line bg-sunken px-2.5 py-1.5 font-mono text-[11.5px] text-ink">
                        {item.installCmd}
                      </code>
                      <IconButton
                        label={copied === item.name ? t.copied : t.copy}
                        size="sm"
                        variant={copied === item.name ? "primary" : "secondary"}
                        onClick={() => void copy(item.installCmd, item.name)}
                      >
                        {copied === item.name ? <IconCheck size={13} /> : <IconCopy size={13} />}
                      </IconButton>
                    </div>
                  )}
                </div>
              ))}
            {/* GitHub connection (plan §3/17): optional, so it never counts as missing.
                Hidden until the shared status has loaded — no wrong state flashes. */}
            {!githubLoading && (
              <div className="mt-1 border-t-2 border-hair px-2 pb-1 pt-3">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] border-2 border-line"
                    style={{
                      background: github.connected ? "var(--green)" : "var(--sunken)",
                      color: github.connected ? "var(--on-green)" : "var(--ink-2)",
                    }}
                  >
                    {github.connected ? <IconCheck size={12} /> : <IconGithub size={12} />}
                  </span>
                  <span className="font-mono text-[13px] font-bold text-ink">{t.githubLabel}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">
                    {github.connected ? (github.user ? `@${github.user}` : t.githubConnected) : t.githubDisconnected}
                  </span>
                  {!github.connected && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<IconGithub size={13} />}
                      onClick={() => {
                        setOpen(false);
                        setConnectOpen(true);
                      }}
                    >
                      {t.githubConnect}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <GithubConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}
