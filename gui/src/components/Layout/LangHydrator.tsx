"use client";

import { useEffect } from "react";
import { useBoardStore } from "@/store/boardStore";

export default function LangHydrator() {
  const setLang = useBoardStore((s) => s.setLang);
  const lang = useBoardStore((s) => s.lang);

  useEffect(() => {
    const stored = localStorage.getItem("lang");
    if (stored === "en" || stored === "tr") setLang(stored);
  }, [setLang]);

  // Keep <html lang> in step with the UI language so CSS `uppercase`
  // uses the right casing rules (tr: i → İ, en: i → I).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return null;
}
