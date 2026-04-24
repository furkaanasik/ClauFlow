"use client";

import { useEffect } from "react";
import { useBoardStore } from "@/store/boardStore";

export default function LangHydrator() {
  const setLang = useBoardStore((s) => s.setLang);

  useEffect(() => {
    const stored = localStorage.getItem("lang");
    if (stored === "en" || stored === "tr") setLang(stored);
  }, [setLang]);

  return null;
}
