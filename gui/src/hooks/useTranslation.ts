"use client";

import { useBoardStore } from "@/store/boardStore";
import { tr } from "@/lib/i18n/tr";
import { en } from "@/lib/i18n/en";

export function useTranslation() {
  const lang = useBoardStore((s) => s.lang);
  return lang === "en" ? en : tr;
}
