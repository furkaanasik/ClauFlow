"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, type AvailablePlugin, type ClaudeMarketplace, type InstalledPlugin } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Toggle";
import { Tag } from "@/components/ui/Chip";
import {
  IconAlert,
  IconArrowUpRight,
  IconCheck,
  IconDownload,
  IconGithub,
  IconPlus,
  IconSearch,
  IconSpinner,
  IconTag,
  IconTrash,
} from "@/components/ui/icons";
import { useBoardStore } from "@/store/boardStore";

interface SkillsManagerModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

type SkillsTab = "installed" | "registry" | "marketplaces";
type PluginScope = "local" | "project" | "user";

const SCOPE_DOT: Record<PluginScope, string> = {
  local:   "var(--cobalt)",
  project: "var(--mustard)",
  user:    "var(--green)",
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

  const scopeLabel = (scope: PluginScope) =>
    scope === "local" ? cs.scopeLocal : scope === "project" ? cs.scopeProject : cs.scopeUser;

  const progressLine = (prog: ReturnType<typeof getProgress>, doneLabel: string) =>
    prog ? (
      <span
        className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium"
        style={{ color: prog.status === "error" ? "var(--red-text)" : prog.status === "done" ? "var(--green-text)" : "var(--orange-text)" }}
      >
        {prog.status === "running" ? <IconSpinner size={12} /> : prog.status === "done" ? <IconCheck size={12} /> : <IconAlert size={12} />}
        {prog.status === "running" ? cs.running : prog.status === "done" ? doneLabel : prog.message ?? cs.error}
      </span>
    ) : null;

  const loadingRows = (
    <div className="flex flex-col gap-2" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="ui-hatch h-[3.75rem] rounded-[10px] border-2 border-dashed border-hair" />
      ))}
    </div>
  );

  const emptyState = (icon: ReactNode, text: string) => (
    <div className="ui-hatch flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed border-line px-6 py-10 text-center">
      <span aria-hidden className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-line bg-panel text-ink-2 shadow-hard">
        {icon}
      </span>
      <p className="max-w-sm text-[13px] text-ink-2">{text}</p>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      icon={<IconTag size={18} />}
      title={cs.listTitle}
      description={cs.modalHint}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {cs.close}
        </Button>
      }
      footerStart={cs.footerHint}
    >
      <div className="-mx-5 -mt-5 mb-4 border-b-0 bg-panel px-5 pt-2">
        <Tabs<SkillsTab>
          label={cs.listTitle}
          value={tab}
          onChange={setTab}
          items={[
            { value: "installed", label: cs.tabInstalled, icon: <IconCheck size={13} />, count: installed?.length || undefined },
            { value: "registry", label: cs.tabRegistry, icon: <IconDownload size={13} /> },
            { value: "marketplaces", label: cs.tabMarketplaces, icon: <IconGithub size={13} /> },
          ]}
        />
      </div>

      <div key={tab} className="ui-tabpanel flex min-h-[320px] flex-col gap-3">
        {loadError && (
          <div role="alert" className="ui-banner ui-banner--error">
            <IconAlert size={15} className="mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}
        {actionError && (
          <div role="alert" className="ui-banner ui-banner--error">
            <IconAlert size={15} className="mt-0.5 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Installed tab */}
        {tab === "installed" && (
          installed === null ? loadingRows
          : installed.length === 0 ? emptyState(<IconTag size={20} />, cs.emptyInstalled)
          : (
            <ul className="flex flex-col gap-2">
              {installed.map((plugin) => {
                const prog = getProgress(plugin.id);
                const isWorking = prog?.status === "running";
                return (
                  <li key={plugin.id} className="ui-row" data-muted={plugin.enabled ? undefined : "true"}>
                    <div className="min-w-0 flex-1" title={plugin.installPath}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-bold text-ink">{plugin.id}</span>
                        {plugin.version && (
                          <span className="font-mono text-[11px] text-ink-3">v{plugin.version}</span>
                        )}
                        <Tag dot={SCOPE_DOT[plugin.scope]} className="!h-5 !text-[11px]">
                          {scopeLabel(plugin.scope)}
                        </Tag>
                      </div>
                      {plugin.projectPath && (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">{plugin.projectPath}</div>
                      )}
                      {progressLine(prog, cs.done)}
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span
                        className="w-[64px] text-right text-[11.5px] font-semibold"
                        style={{ color: plugin.enabled ? "var(--green-text)" : "var(--ink-3)" }}
                      >
                        {plugin.enabled ? cs.enabled : cs.disabled}
                      </span>
                      <Switch
                        checked={plugin.enabled}
                        onCheckedChange={() => void handleToggleEnable(plugin)}
                        label={plugin.enabled ? cs.disable : cs.enable}
                        disabled={isWorking}
                      />
                      <IconButton
                        label={cs.uninstall}
                        size="sm"
                        variant="danger"
                        disabled={isWorking}
                        loading={uninstallingId === plugin.id}
                        onClick={() => setConfirmUninstall(plugin.id)}
                      >
                        <IconTrash size={13} />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        )}

        {/* Registry tab */}
        {tab === "registry" && (
          <>
            <Input
              icon={<IconSearch size={14} />}
              value={registrySearch}
              onChange={(e) => setRegistrySearch(e.target.value)}
              placeholder={cs.searchRegistryPlaceholder}
              aria-label={cs.searchRegistryPlaceholder}
              spellCheck={false}
            />
            {registry === null ? loadingRows
            : filteredRegistry.length === 0 ? emptyState(<IconSearch size={20} />, cs.emptyRegistry)
            : (
              <ul className="flex flex-col gap-2">
                {filteredRegistry.map((avail) => {
                  const alreadyInstalled = installedIds.has(avail.pluginId);
                  const prog = getProgress(avail.pluginId);
                  const isWorking = prog?.status === "running";
                  const externalUrl = avail.homepage
                    ?? avail.source.url
                    ?? (avail.source.repo ? `https://github.com/${avail.source.repo}` : undefined);
                  const scope = scopeMap[avail.pluginId] ?? "local";
                  return (
                    <li key={avail.pluginId} className="ui-row !items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-bold text-ink">{avail.name}</span>
                          <span className="font-mono text-[11px] text-ink-3">{avail.pluginId}</span>
                          {avail.marketplaceName && (
                            <Tag className="!h-5 !text-[11px]">{avail.marketplaceName}</Tag>
                          )}
                        </div>
                        {avail.description && (
                          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{avail.description}</p>
                        )}
                        {(avail.author || avail.installCount !== undefined) && (
                          <div className="mt-1 flex items-center gap-3 font-mono text-[11px] text-ink-3">
                            {avail.author && <span>{cs.author}: {avail.author}</span>}
                            {avail.installCount !== undefined && (
                              <span>{cs.installCount.replace("{n}", String(avail.installCount))}</span>
                            )}
                          </div>
                        )}
                        {progressLine(prog, cs.installed)}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5 self-center">
                        {externalUrl && (
                          <a
                            href={externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={cs.viewSkill}
                            aria-label={cs.viewSkill}
                            className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-focus"
                          >
                            <IconArrowUpRight size={13} />
                          </a>
                        )}
                        {alreadyInstalled ? (
                          <span className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-green px-2.5 py-0.5 text-[11.5px] font-bold text-[var(--on-green)]">
                            <IconCheck size={12} />
                            {cs.installed}
                          </span>
                        ) : (
                          <>
                            <Select
                              size="sm"
                              value={scope}
                              onChange={(e) =>
                                setScopeMap((prev) => ({ ...prev, [avail.pluginId]: e.target.value as PluginScope }))
                              }
                              disabled={isWorking}
                              aria-label={cs.chooseScope}
                              title={cs.chooseScope}
                              className="w-[104px] font-mono"
                            >
                              <option value="local">{cs.scopeLocal}</option>
                              <option value="project">{cs.scopeProject}</option>
                              <option value="user">{cs.scopeUser}</option>
                            </Select>
                            <Button
                              size="sm"
                              variant="primary"
                              icon={<IconDownload size={13} />}
                              loading={isWorking}
                              onClick={() => void handleInstall(avail.pluginId)}
                            >
                              {isWorking ? cs.installing : cs.install}
                            </Button>
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
          <>
            <div className="flex items-center gap-2">
              <Input
                icon={<IconGithub size={14} />}
                value={mpSource}
                onChange={(e) => setMpSource(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleAddMarketplace(); }}
                disabled={mpAdding}
                placeholder={cs.marketplaceSourcePlaceholder}
                aria-label={cs.marketplaceSource}
                spellCheck={false}
                className="font-mono"
              />
              <Button
                variant="primary"
                icon={<IconPlus size={14} />}
                onClick={() => void handleAddMarketplace()}
                disabled={!mpSource.trim()}
                loading={mpAdding}
                className="whitespace-nowrap"
              >
                {cs.addMarketplace}
              </Button>
            </div>

            {marketplaces === null ? loadingRows
            : marketplaces.length === 0 ? emptyState(<IconGithub size={20} />, cs.noMarketplaces)
            : (
              <ul className="flex flex-col gap-2">
                {marketplaces.map((mp) => {
                  const src = mp.source.repo ?? mp.source.url ?? mp.source.path ?? mp.source.source;
                  return (
                    <li key={mp.name} className="ui-row">
                      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border-2 border-line bg-sunken text-ink-2">
                        <IconGithub size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[13px] font-bold text-ink">{mp.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">{src}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<IconTrash size={13} />}
                        onClick={() => setConfirmRemoveMarketplace(mp.name)}
                      >
                        {cs.removeMarketplace}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
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
    </Modal>
  );
}
