"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { api, type AvailablePlugin, type ClaudeMarketplace, type InstalledPlugin } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useBoardStore } from "@/store/boardStore";

interface SkillsManagerModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

type SkillsTab = "installed" | "registry" | "marketplaces";
type PluginScope = "local" | "project" | "user";

function SkillSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-[var(--text-muted)]"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const SCOPE_COLORS: Record<PluginScope, string> = {
  local:   "bg-blue-500/15 text-blue-400",
  project: "bg-purple-500/15 text-purple-400",
  user:    "bg-emerald-500/15 text-emerald-400",
};

export function SkillsManagerModal({ projectId, open, onClose }: SkillsManagerModalProps) {
  const t = useTranslation();
  const cs = t.claudeSkills;
  const [tab, setTab] = useState<SkillsTab>("installed");

  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [registry, setRegistry] = useState<AvailablePlugin[] | null>(null);
  const [marketplaces, setMarketplaces] = useState<ClaudeMarketplace[] | null>(null);
  const [scopeMap, setScopeMap] = useState<Record<string, PluginScope>>({});

  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [confirmRemoveMarketplace, setConfirmRemoveMarketplace] = useState<string | null>(null);
  const [mpSource, setMpSource] = useState("");
  const [mpAdding, setMpAdding] = useState(false);
  const [registrySearch, setRegistrySearch] = useState("");

  const skillProgress = useBoardStore((s) => s.skillProgress);
  const clearSkillProgress = useBoardStore((s) => s.clearSkillProgress);

  const getProgress = (pluginId: string) => skillProgress[`${projectId}:${pluginId}`];

  const loadInstalled = async () => {
    setLoadError(null);
    try {
      const data = await api.listInstalledSkills(projectId);
      setInstalled(data.installed);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : cs.loadError);
    }
  };

  const loadRegistry = async (force = false) => {
    if (registry !== null && !force) return;
    setLoadError(null);
    try {
      const data = await api.listSkillRegistry(projectId);
      setRegistry(data.available);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : cs.loadError);
    }
  };

  const loadMarketplaces = async () => {
    setLoadError(null);
    try {
      const data = await api.listMarketplaces(projectId);
      setMarketplaces(data.marketplaces);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : cs.marketplaceLoadError);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadInstalled();
  }, [projectId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    if (tab === "registry")     void loadRegistry();
    if (tab === "marketplaces") void loadMarketplaces();
  }, [tab, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const done = Object.entries(skillProgress)
      .filter(([k]) => k.startsWith(`${projectId}:`))
      .some(([, v]) => v.status === "done");
    if (done) void loadInstalled();
  }, [skillProgress, projectId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleInstall = async (pluginId: string) => {
    setActionError(null);
    const scope = scopeMap[pluginId] ?? "local";
    try {
      await api.installSkill(projectId, pluginId, scope);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.installError);
    }
  };

  const handleToggleEnable = async (plugin: InstalledPlugin) => {
    setActionError(null);
    try {
      if (plugin.enabled) {
        await api.disableSkill(projectId, plugin.id);
      } else {
        await api.enableSkill(projectId, plugin.id);
      }
      await loadInstalled();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : (plugin.enabled ? cs.disableError : cs.enableError),
      );
    }
  };

  const handleUninstall = async (pluginId: string) => {
    setConfirmUninstall(null);
    setActionError(null);
    setUninstallingId(pluginId);
    try {
      await api.uninstallSkill(projectId, pluginId);
      clearSkillProgress(projectId, pluginId);
      await loadInstalled();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.uninstallError);
    } finally {
      setUninstallingId(null);
    }
  };

  const handleAddMarketplace = async () => {
    const raw = mpSource.trim();
    if (!raw) return;
    setMpAdding(true);
    setActionError(null);
    try {
      await api.addMarketplace(projectId, raw);
      setMpSource("");
      await loadMarketplaces();
      void loadRegistry(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.marketplaceAddError);
    } finally {
      setMpAdding(false);
    }
  };

  const handleRemoveMarketplace = async (name: string) => {
    setActionError(null);
    try {
      await api.removeMarketplace(projectId, name);
      await loadMarketplaces();
      void loadRegistry(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : cs.marketplaceRemoveError);
    }
  };

  const installedIds = new Set((installed ?? []).map((p) => p.id));

  const filteredRegistry = (registry ?? []).filter((sk) => {
    const q = registrySearch.toLowerCase();
    return (
      !q ||
      sk.name.toLowerCase().includes(q) ||
      sk.description?.toLowerCase().includes(q) ||
      sk.marketplaceName?.toLowerCase().includes(q)
    );
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-[80vh] w-full max-w-2xl flex-col bg-[var(--bg-base)] border border-[var(--border)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)]">
            {cs.listTitle}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--border)] p-1.5 text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Tab bar */}
          <div className="flex border border-[var(--border)]">
            {(
              [
                { key: "installed"    as SkillsTab, label: cs.tabInstalled },
                { key: "registry"     as SkillsTab, label: cs.tabRegistry },
                { key: "marketplaces" as SkillsTab, label: cs.tabMarketplaces },
              ] as const
            ).map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                className={clsx(
                  "flex-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] transition",
                  tab === tb.key
                    ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                )}
              >
                {tb.label}
                {tb.key === "installed" && (installed?.length ?? 0) > 0 && (
                  <span className="ml-1.5 font-mono text-[10px] opacity-70">({installed!.length})</span>
                )}
              </button>
            ))}
          </div>

          {loadError && (
            <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
              {loadError}
            </div>
          )}
          {actionError && (
            <div className="border border-[var(--status-error)] bg-[var(--status-error-ink)] px-3 py-2 text-[12px] text-[var(--status-error)]">
              {actionError}
            </div>
          )}

          {/* Installed tab */}
          {tab === "installed" && (
            <>
              {installed === null ? (
                <div className="flex justify-center py-6"><SkillSpinner /></div>
              ) : installed.length === 0 ? (
                <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                  {cs.emptyInstalled}
                </div>
              ) : (
                <ul className="flex flex-col border border-[var(--border)]">
                  {installed.map((plugin) => {
                    const prog = getProgress(plugin.id);
                    const isWorking = prog?.status === "running";
                    const scopeLabel =
                      plugin.scope === "local"   ? cs.scopeLocal   :
                      plugin.scope === "project" ? cs.scopeProject :
                      cs.scopeUser;
                    return (
                      <li
                        key={plugin.id}
                        className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1" title={plugin.installPath}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                              {plugin.id}
                            </span>
                            {plugin.version && (
                              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                                v{plugin.version}
                              </span>
                            )}
                            <span
                              className={clsx(
                                "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]",
                                SCOPE_COLORS[plugin.scope],
                              )}
                            >
                              {scopeLabel}
                            </span>
                          </div>
                          {plugin.projectPath && (
                            <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-faint)]">
                              {plugin.projectPath}
                            </div>
                          )}
                          {prog && (
                            <div
                              className={clsx(
                                "mt-0.5 text-[11px]",
                                prog.status === "error" ? "text-[var(--status-error)]" : "text-[var(--text-muted)]",
                              )}
                            >
                              {prog.status === "running" ? cs.running :
                               prog.status === "done"    ? cs.done    :
                               prog.message ?? cs.error}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={clsx(
                              "text-[10px] uppercase tracking-[0.08em]",
                              plugin.enabled ? "text-[var(--accent-primary)]" : "text-[var(--text-faint)]",
                            )}
                          >
                            {plugin.enabled ? cs.enabled : cs.disabled}
                          </span>
                          <button
                            type="button"
                            disabled={isWorking}
                            onClick={() => void handleToggleEnable(plugin)}
                            className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                          >
                            {plugin.enabled ? cs.disable : cs.enable}
                          </button>
                          <button
                            type="button"
                            disabled={isWorking || uninstallingId === plugin.id}
                            onClick={() => setConfirmUninstall(plugin.id)}
                            className="inline-flex items-center gap-1.5 border border-[var(--status-error)] bg-transparent px-2 py-1 text-[11px] text-[var(--status-error)] transition hover:bg-[var(--status-error-ink)] disabled:opacity-60"
                          >
                            {uninstallingId === plugin.id && (
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            )}
                            {uninstallingId === plugin.id ? cs.uninstalling : cs.uninstall}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {/* Registry tab */}
          {tab === "registry" && (
            <>
              <input
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                placeholder={cs.searchRegistryPlaceholder}
                spellCheck={false}
                className="w-full border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)] placeholder:text-[var(--text-faint)]"
              />
              {registry === null ? (
                <div className="flex justify-center py-6"><SkillSpinner /></div>
              ) : filteredRegistry.length === 0 ? (
                <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                  {cs.emptyRegistry}
                </div>
              ) : (
                <ul className="flex flex-col border border-[var(--border)]">
                  {filteredRegistry.map((avail) => {
                    const alreadyInstalled = installedIds.has(avail.pluginId);
                    const prog = getProgress(avail.pluginId);
                    const isWorking = prog?.status === "running";
                    const externalUrl = avail.homepage
                      ?? avail.source.url
                      ?? (avail.source.repo ? `https://github.com/${avail.source.repo}` : undefined);
                    const scope = scopeMap[avail.pluginId] ?? "local";
                    return (
                      <li
                        key={avail.pluginId}
                        className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                              {avail.name}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--text-faint)]">
                              {avail.pluginId}
                            </span>
                            {avail.marketplaceName && (
                              <span className="text-[10px] text-[var(--text-faint)]">
                                {avail.marketplaceName}
                              </span>
                            )}
                          </div>
                          {avail.description && (
                            <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                              {avail.description}
                            </div>
                          )}
                          <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--text-faint)]">
                            {avail.author && <span>{cs.author}: {avail.author}</span>}
                            {avail.installCount !== undefined && (
                              <span>{cs.installCount.replace("{n}", String(avail.installCount))}</span>
                            )}
                          </div>
                          {prog && (
                            <div
                              className={clsx(
                                "mt-0.5 text-[11px]",
                                prog.status === "error" ? "text-[var(--status-error)]" : "text-[var(--text-muted)]",
                              )}
                            >
                              {prog.status === "running" ? cs.running :
                               prog.status === "done"    ? cs.installed :
                               prog.message ?? cs.error}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5 self-center">
                          {externalUrl && (
                            <a
                              href={externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={cs.viewSkill}
                              className="flex items-center border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-[var(--text-muted)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" />
                                <path d="M8 1h3v3" />
                                <path d="M11 1L5.5 6.5" />
                              </svg>
                            </a>
                          )}
                          {alreadyInstalled ? (
                            <span className="text-[11px] text-[var(--accent-primary)]">
                              ✓ {cs.installed}
                            </span>
                          ) : (
                            <>
                              <select
                                value={scope}
                                onChange={(e) =>
                                  setScopeMap((prev) => ({ ...prev, [avail.pluginId]: e.target.value as PluginScope }))
                                }
                                disabled={isWorking}
                                title={cs.chooseScope}
                                className="border border-[var(--border)] bg-[var(--bg-surface)] px-1.5 py-1 font-mono text-[10px] text-[var(--text-secondary)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-40"
                              >
                                <option value="local">{cs.scopeLocal}</option>
                                <option value="project">{cs.scopeProject}</option>
                                <option value="user">{cs.scopeUser}</option>
                              </select>
                              <button
                                type="button"
                                disabled={isWorking}
                                onClick={() => void handleInstall(avail.pluginId)}
                                className="btn-ink px-3 py-1.5 text-[11px] disabled:opacity-50"
                              >
                                {isWorking ? cs.installing : cs.install}
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {/* Marketplaces tab */}
          {tab === "marketplaces" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  value={mpSource}
                  onChange={(e) => setMpSource(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAddMarketplace(); }}
                  disabled={mpAdding}
                  placeholder={cs.marketplaceSourcePlaceholder}
                  spellCheck={false}
                  className="flex-1 border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none transition focus:border-[var(--text-secondary)] disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void handleAddMarketplace()}
                  disabled={mpAdding || !mpSource.trim()}
                  className="btn-ink whitespace-nowrap px-3 py-1.5 text-[11px] disabled:opacity-50"
                >
                  {mpAdding ? "…" : cs.addMarketplace}
                </button>
              </div>

              {marketplaces === null ? (
                <div className="flex justify-center py-6"><SkillSpinner /></div>
              ) : marketplaces.length === 0 ? (
                <div className="border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">
                  {cs.noMarketplaces}
                </div>
              ) : (
                <ul className="flex flex-col border border-[var(--border)]">
                  {marketplaces.map((mp) => {
                    const src = mp.source.repo ?? mp.source.url ?? mp.source.path ?? mp.source.source;
                    return (
                      <li
                        key={mp.name}
                        className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                            {mp.name}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-faint)]">
                            {src}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveMarketplace(mp.name)}
                          className="shrink-0 border border-[var(--status-error)] bg-transparent px-2 py-1 text-[11px] text-[var(--status-error)] transition hover:bg-[var(--status-error-ink)]"
                        >
                          {cs.removeMarketplace}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <ConfirmDialog
          open={confirmUninstall !== null}
          title={cs.confirmUninstallTitle}
          description={cs.confirmUninstallDescription}
          confirmLabel={cs.uninstall}
          cancelLabel={cs.cancel}
          variant="danger"
          onConfirm={() => {
            if (confirmUninstall) void handleUninstall(confirmUninstall);
          }}
          onCancel={() => setConfirmUninstall(null)}
        />

        <ConfirmDialog
          open={confirmRemoveMarketplace !== null}
          title={cs.confirmRemoveMarketplaceTitle}
          description={cs.confirmRemoveMarketplaceDescription}
          confirmLabel={cs.removeMarketplace}
          cancelLabel={cs.cancel}
          variant="danger"
          onConfirm={() => {
            if (confirmRemoveMarketplace) void handleRemoveMarketplace(confirmRemoveMarketplace);
          }}
          onCancel={() => setConfirmRemoveMarketplace(null)}
        />
      </div>
    </div>
  );
}
