"use client";

import { create } from "zustand";

interface NotificationState {
  browserEnabled: boolean;
  setBrowserEnabled: (v: boolean) => void;
  requestPermission: () => Promise<void>;
  notify: (title: string, body: string) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  browserEnabled:
    typeof window !== "undefined"
      ? localStorage.getItem("notif-browser-enabled") === "true"
      : false,

  setBrowserEnabled: (v) => {
    localStorage.setItem("notif-browser-enabled", String(v));
    set({ browserEnabled: v });
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

  notify: (title, body) => {
    const { browserEnabled } = get();

    if (
      browserEnabled &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      new Notification(title, { body });
    }
  },
}));

export function useNotification() {
  return {
    notify: useNotificationStore((s) => s.notify),
    requestPermission: useNotificationStore((s) => s.requestPermission),
  };
}
