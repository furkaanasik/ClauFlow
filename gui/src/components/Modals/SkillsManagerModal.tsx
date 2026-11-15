"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, type InstalledPlugin } from "@/lib/api";
import { errorText } from "@/lib/errorText";
import { useTranslation } from "@/hooks/useTranslation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Toggle";
import { Tag } from "@/components/ui/Chip";
import { IconAlert, IconTag, IconTrash } from "@/components/ui/icons";

interface SkillsManagerModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

type PluginScope = "local" | "project" | "user";

const SCOPE_DOT: Record<PluginScope, string> = {
  local:   "var(--cobalt)",
  project: "var(--mustard)",
  user:    "var(--green)",
};

export function SkillsManagerModal({ projectId, open, onClose }: SkillsManagerModalProps) {
  const t = useTranslation();
  const cs = t.claudeSkills;

  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadInstalled = async () => {
    setLoadError(null);
    try {
      const data = await api.listInstalledSkills(projectId);
      setInstalled(data.installed);
    } catch (err) {
      setLoadError(errorText(t, err, cs.loadError));
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadInstalled();
  }, [projectId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleEnable = async (plugin: InstalledPlugin) => {
    setActionError(null);
    setTogglingId(plugin.id);
    try {
      if (plugin.enabled) {
        await api.disableSkill(projectId, plugin.id);
      } else {
        await api.enableSkill(projectId, plugin.id);
      }
      await loadInstalled();
    } catch (err) {
      setActionError(
        errorText(t, err, (plugin.enabled ? cs.disableError : cs.enableError)),
      );
    } finally {
      setTogglingId(null);
    }
  };

  const handleUninstall = async (pluginId: string) => {
    setConfirmUninstall(null);
    setActionError(null);
    setUninstallingId(pluginId);
    try {
      await api.uninstallSkill(projectId, pluginId);
      await loadInstalled();
    } catch (err) {
      setActionError(errorText(t, err, cs.uninstallError));
    } finally {
      setUninstallingId(null);
    }
  };

  const scopeLabel = (scope: PluginScope) =>
    scope === "local" ? cs.scopeLocal : scope === "project" ? cs.scopeProject : cs.scopeUser;

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
      <div className="flex min-h-[320px] flex-col gap-3">
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

        {installed === null ? loadingRows
        : installed.length === 0 ? emptyState(<IconTag size={20} />, cs.emptyInstalled)
        : (
          <ul className="flex flex-col gap-2">
            {installed.map((plugin) => {
              const isWorking = uninstallingId === plugin.id || togglingId === plugin.id;
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
    </Modal>
  );
}
