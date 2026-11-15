"use client";

import { ApiError } from "@/lib/api";
import { apiErrorCode } from "@/lib/errorText";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * zincir F0.5 (plan §5.0): the `detected` branch of a `422 base_branch_missing`
 * from project create/update, or undefined when the error is something else.
 * `null` means the core could not guess a branch.
 */
export function detectedBranchOf(err: unknown): string | null | undefined {
  if (apiErrorCode(err) !== "base_branch_missing") return undefined;
  const body = (err as ApiError).body as { detected?: unknown } | null;
  return typeof body?.detected === "string" && body.detected ? body.detected : null;
}

/**
 * Inline note under a base-branch field: "Repo is on: main · Use this".
 * Rendered inside a Field's error line (a `<p>`), so it stays phrasing content.
 */
export function DetectedBranchNote({ detected, onUse }: { detected: string; onUse: (branch: string) => void }) {
  const t = useTranslation();
  return (
    <>
      <span>{t.newProject.repoIsOn(detected)}</span>
      <span aria-hidden className="mx-1.5 text-ink-3">·</span>
      <button
        type="button"
        onClick={() => onUse(detected)}
        className="ui-focus rounded-[4px] font-semibold text-[var(--cobalt-text)] underline underline-offset-2 hover:text-ink"
      >
        {t.newProject.useDetected}
      </button>
    </>
  );
}
