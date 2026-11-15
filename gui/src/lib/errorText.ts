import { ApiError } from "@/lib/api";
import type { ErrorCode, Translations } from "@/lib/i18n/types";

/** The `{ error: "<code>" }` string of an API error body, if any. */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body;
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return null;
}

/**
 * Translates a core error code (§5.4) into the UI language. Unknown codes and
 * free text (older rows, raw git/CLI output) are shown as they are.
 */
export function errorText(t: Translations, raw: unknown, fallback?: string): string {
  const code = typeof raw === "string" ? raw : apiErrorCode(raw);
  if (code && Object.prototype.hasOwnProperty.call(t.errors, code)) {
    return t.errors[code as ErrorCode];
  }
  if (typeof raw === "string") return raw;
  if (code) return code;
  if (raw instanceof Error && raw.message) return raw.message;
  return fallback ?? String(raw);
}
