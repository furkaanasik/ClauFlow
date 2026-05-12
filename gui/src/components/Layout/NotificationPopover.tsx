"use client";

import { useState, useEffect, useRef } from "react";
import { useNotificationStore } from "@/hooks/useNotification";

export function NotificationPopover() {
  const [open, setOpen] = useState(false);
  const [webhookInput, setWebhookInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const browserEnabled = useNotificationStore((s) => s.browserEnabled);
  const webhookUrl = useNotificationStore((s) => s.webhookUrl);
  const setBrowserEnabled = useNotificationStore((s) => s.setBrowserEnabled);
  const setWebhookUrl = useNotificationStore((s) => s.setWebhookUrl);
  const requestPermission = useNotificationStore((s) => s.requestPermission);

  const permission =
    typeof Notification !== "undefined" ? Notification.permission : "default";

  useEffect(() => {
    setWebhookInput(webhookUrl);
  }, [webhookUrl]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleEnable = async () => {
    await requestPermission();
  };

  const handleSave = () => {
    setWebhookUrl(webhookInput.trim());
    setOpen(false);
  };

  const handleBrowserToggle = () => {
    if (!browserEnabled && permission !== "granted") {
      void handleEnable();
    } else {
      setBrowserEnabled(!browserEnabled);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
        title="Notifications"
      >
        <BellIcon />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Notifications
            </span>
          </div>

          <div className="px-4 py-3 space-y-4">
            {/* Browser notifications row */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] text-[var(--text-primary)]">Browser notifications</p>
                {permission === "denied" && (
                  <p className="mt-0.5 text-[11px] text-[var(--status-error)]">Blocked by browser</p>
                )}
                {permission === "granted" && browserEnabled && (
                  <p className="mt-0.5 text-[11px] text-[var(--accent-primary)]">Enabled</p>
                )}
                {permission === "granted" && !browserEnabled && (
                  <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">Permission granted — toggle to enable</p>
                )}
                {permission === "default" && (
                  <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">Not yet requested</p>
                )}
              </div>
              {permission === "denied" ? null : permission === "default" ? (
                <button
                  type="button"
                  onClick={handleEnable}
                  className="shrink-0 border border-[var(--border)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
                >
                  Enable
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBrowserToggle}
                  className={`relative shrink-0 h-5 w-9 rounded-full border transition ${
                    browserEnabled
                      ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
                      : "border-[var(--border)] bg-[var(--bg-base)]"
                  }`}
                  title={browserEnabled ? "Disable" : "Enable"}
                >
                  <span
                    className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${
                      browserEnabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              )}
            </div>

            {/* Webhook URL row */}
            <div className="space-y-1.5">
              <label className="block text-[13px] text-[var(--text-primary)]">Webhook URL</label>
              <input
                type="url"
                value={webhookInput}
                onChange={(e) => setWebhookInput(e.target.value)}
                placeholder="https://hooks.slack.com/..."
                className="w-full border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent-primary)]"
              />
              <button
                type="button"
                onClick={handleSave}
                className="w-full border border-[var(--border)] py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
