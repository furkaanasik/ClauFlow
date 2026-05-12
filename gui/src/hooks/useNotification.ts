"use client";

import { create } from "zustand";

interface NotificationState {
  browserEnabled: boolean;
  webhookUrl: string;
  setBrowserEnabled: (v: boolean) => void;
  setWebhookUrl: (url: string) => void;
  requestPermission: () => Promise<void>;
  notify: (title: string, body: string, isError: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  browserEnabled:
    typeof window !== "undefined"
      ? localStorage.getItem("notif-browser-enabled") === "true"
      : false,
  webhookUrl:
    typeof window !== "undefined"
      ? (localStorage.getItem("notif-webhook-url") ?? "")
      : "",

  setBrowserEnabled: (v) => {
    localStorage.setItem("notif-browser-enabled", String(v));
    set({ browserEnabled: v });
  },

  setWebhookUrl: (url) => {
    localStorage.setItem("notif-webhook-url", url);
    set({ webhookUrl: url });
  },

  requestPermission: async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      get().setBrowserEnabled(true);
      return;
    }
    const result = await Notification.requestPermission();
    if (result === "granted") get().setBrowserEnabled(true);
  },

  notify: (title, body, isError) => {
    const { browserEnabled, webhookUrl } = get();

    if (
      browserEnabled &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      new Notification(title, { body });
    }

    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, isError, ts: Date.now() }),
      }).catch(() => {});
    }
  },
}));

export function useNotification() {
  return {
    notify: useNotificationStore((s) => s.notify),
    requestPermission: useNotificationStore((s) => s.requestPermission),
  };
}
