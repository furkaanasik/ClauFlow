import { ApiError } from "@/lib/api";
import type { ConflictReason, ErrorCode, Translations } from "@/lib/i18n/types";

/** The `{ error: "<code>" }` string of an API error body, if any. */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body;
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/**
 * The hint an error body carries next to its code: `current` for a run,
 * `detected` for a project (422), zincir's cycle `path` ("CLF-3 → CLF-2 → CLF-3")
 * and `unmet` dependency keys.
 */
function bodyDetail(raw: unknown): string | null {
  if (!(raw instanceof ApiError)) return null;
  const body = raw.body as { current?: unknown; detected?: unknown; path?: unknown; unmet?: unknown } | null;
  if (!body || typeof body !== "object") return null;
  if (typeof body.current === "string" && body.current) return body.current;
  if (typeof body.detected === "string" && body.detected) return body.detected;
  const path = stringList(body.path);
  if (path.length > 0) return path.join(" → ");
  const unmet = stringList(body.unmet);
  if (unmet.length > 0) return unmet.join(", ");
  return null;
}

/** Puts `detail` into `{detail}`, or appends it in parentheses when there is no placeholder. */
function withDetail(text: string, detail: string | null): string {
  if (text.includes("{detail}")) return text.split("{detail}").join(detail ?? "-");
  return detail ? `${text} (${detail})` : text;
}

/**
 * `role_timeout:developer` → the drawer's role label ("Yazılımcı");
 * `conflict_unresolved:qa_fail` → `conflict.reason.qa_fail` (zincir F4.6);
 * other (and unknown) details as they are.
 */
function codeDetail(t: Translations, code: string, detail: string): string {
  if (code === "role_timeout" && Object.prototype.hasOwnProperty.call(t.team.roles, detail)) {
    return t.team.roles[detail as keyof Translations["team"]["roles"]];
  }
  if (code === "conflict_unresolved" && Object.prototype.hasOwnProperty.call(t.conflict.reason, detail)) {
    return t.conflict.reason[detail as ConflictReason];
  }
  return detail;
}

function knownCode(t: Translations, code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(t.errors, code);
}

/**
 * Translates a core error code (§5.4) into the UI language. A stored
 * `code:detail` value (zincir F0.5, e.g. `base_branch_missing:main`) fills the
 * translation's `{detail}`. Unknown codes and free text (older rows, raw
 * git/CLI output) are shown as they are.
 */
export function errorText(t: Translations, raw: unknown, fallback?: string): string {
  const code = typeof raw === "string" ? raw : apiErrorCode(raw);
  if (code && knownCode(t, code)) return withDetail(t.errors[code], bodyDetail(raw));
  if (code) {
    const m = /^([a-z_]+):([\s\S]+)$/.exec(code);
    if (m && knownCode(t, m[1]!)) return withDetail(t.errors[m[1] as ErrorCode], codeDetail(t, m[1]!, m[2]!.trim()));
  }
  if (typeof raw === "string") return raw;
  if (code) return code;
  if (raw instanceof Error && raw.message) return raw.message;
  return fallback ?? String(raw);
}
