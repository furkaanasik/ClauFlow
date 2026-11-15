"use client";

import { useId, useRef, useState } from "react";
import { useNotificationStore } from "@/hooks/useNotification";
import { useTranslation } from "@/hooks/useTranslation";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Toggle";
import { IconBell, IconCheck } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/overlay";

export function NotificationPopover() {
  const t = useTranslation().notifications;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const browserEnabled = useNotificationStore((s) => s.browserEnabled);
  const setBrowserEnabled = useNotificationStore((s) => s.setBrowserEnabled);
  const requestPermission = useNotificationStore((s) => s.requestPermission);

  const permission = typeof Notification !== "undefined" ? Notification.permission : "default";

  useDismiss(ref, open, () => setOpen(false));

  const handleEnable = async () => {
    await requestPermission();
  };

  const handleBrowserToggle = () => {
    if (!browserEnabled && permission !== "granted") {
      void handleEnable();
    } else {
      setBrowserEnabled(!browserEnabled);
    }
  };

  const active = permission === "granted" && browserEnabled;

  const browserState =
    permission === "denied"
      ? { text: t.blocked, tone: "var(--red-text)" }
      : permission === "granted" && browserEnabled
        ? { text: t.enabled, tone: "var(--green-text)" }
        : permission === "granted"
          ? { text: t.grantedHint, tone: "var(--ink-3)" }
          : { text: t.notRequested, tone: "var(--ink-3)" };

  return (
    <div className="relative" ref={ref}>
      <IconButton
        label={t.title}
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="relative"
      >
        <IconBell size={16} />
        {active && (
          <span
            aria-hidden
            className="absolute right-1 top-1 h-2 w-2 rounded-full border-[1.5px] border-line bg-green"
          />
        )}
      </IconButton>

      {open && (
        <div id={panelId} role="dialog" aria-label={t.title} className="ui-menu right-0 top-[calc(100%+10px)] w-[320px] overflow-hidden">
          <header className="flex items-center gap-2 border-b-2 border-line px-4 py-3">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-[8px] border-2 border-line bg-mustard text-[var(--on-mustard)]"
            >
              <IconBell size={14} />
            </span>
            <span className="text-[14px] font-bold text-ink">{t.title}</span>
          </header>

          <div className="flex flex-col gap-4 px-4 py-4">
            {/* Browser notifications */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-ink">{t.browser}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{t.browserHint}</p>
                <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold" style={{ color: browserState.tone }}>
                  {permission === "granted" && browserEnabled && <IconCheck size={12} />}
                  {browserState.text}
                </p>
              </div>
              {permission === "denied" ? null : permission === "default" ? (
                <Button size="sm" variant="secondary" onClick={handleEnable}>
                  {t.enable}
                </Button>
              ) : (
                <Switch checked={browserEnabled} onCheckedChange={handleBrowserToggle} label={t.toggle} className="mt-0.5" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
