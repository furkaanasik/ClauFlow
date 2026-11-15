import type { QaVerdict } from "../types/index.js";

export const STALL_THRESHOLD = 0.8;

export interface ParsedQaVerdict {
  verdict: QaVerdict;
  /** False when no VERDICT line was found (treated as FAIL). */
  hadVerdict: boolean;
  /** Numbered bug items, without their numbers. */
  bugs: string[];
  /** Bug list as handed to the developer. */
  bugListText: string;
}

const VERDICT_RE = /^[\s>*_`#-]*VERDICT\s*[:：]\s*[*_`]*\s*(PASS|FAIL)\b/gim;
const BUG_HEADING_RE = /^#{1,6}\s*(?:Hata listesi|Bug list|Bugs)\s*:?\s*$/im;

function bugSection(text: string): string | null {
  const m = BUG_HEADING_RE.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = /^#{1,2}\s+\S/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function numberedItems(section: string): string[] {
  const items: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    const m = /^\s*(?:\d+[.)]|[-*])\s+(.*\S)\s*$/.exec(line);
    if (m) items.push(m[1]!);
    else if (items.length > 0 && line.trim() && /^\s{2,}/.test(line)) {
      items[items.length - 1] += ` ${line.trim()}`;
    }
  }
  return items;
}

export function parseQaVerdict(text: string): ParsedQaVerdict {
  const matches = [...text.matchAll(VERDICT_RE)];
  const last = matches[matches.length - 1];
  if (!last) {
    console.warn("[teamRunner] QA report has no VERDICT line; treating it as FAIL");
    const whole = text.trim();
    return { verdict: "fail", hadVerdict: false, bugs: whole ? [whole] : [], bugListText: whole };
  }
  const verdict: QaVerdict = last[1]!.toUpperCase() === "PASS" ? "pass" : "fail";
  if (verdict === "pass") return { verdict, hadVerdict: true, bugs: [], bugListText: "" };
  const section = bugSection(text);
  const bugs = section ? numberedItems(section) : [];
  const bugListText = section || text.trim();
  return { verdict, hadVerdict: true, bugs: bugs.length > 0 ? bugs : [bugListText], bugListText };
}

export function normalizeBug(item: string): string {
  return item
    .toLowerCase()
    .replace(/[\p{P}\p{S}\d]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(items: string[]): Set<string> {
  const words = new Set<string>();
  for (const item of items) {
    for (const w of normalizeBug(item).split(" ")) if (w) words.add(w);
  }
  return words;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** True when two consecutive QA bug lists are essentially the same. */
export function isStalled(previous: string[], current: string[], threshold = STALL_THRESHOLD): boolean {
  const a = wordSet(previous);
  const b = wordSet(current);
  if (a.size === 0 || b.size === 0) return false;
  return jaccard(a, b) >= threshold;
}

/** `Kabul kriterleri` / `Acceptance criteria` section of a spec, else its AC-n lines. */
export function extractSpecAcceptanceCriteria(spec: string | null | undefined): string | null {
  if (!spec) return null;
  const heading = /^#{1,6}\s*(?:Kabul kriterleri|Acceptance criteria)\s*:?\s*$/im.exec(spec);
  if (heading) {
    const rest = spec.slice(heading.index + heading[0].length);
    const next = /^#{1,6}\s+\S/m.exec(rest);
    const body = (next ? rest.slice(0, next.index) : rest).trim();
    if (body) return body;
  }
  const lines = spec.split(/\r?\n/).filter((l) => /\bAC-\d+\b/.test(l));
  return lines.length > 0 ? lines.join("\n").trim() : null;
}
