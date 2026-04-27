const TURKISH_MAP: Record<string, string> = {
  "ç": "c",
  "Ç": "c",
  "ğ": "g",
  "Ğ": "g",
  "ı": "i",
  "İ": "i",
  "ö": "o",
  "Ö": "o",
  "ş": "s",
  "Ş": "s",
  "ü": "u",
  "Ü": "u",
};

export function slugify(input: string, maxLength = 50): string {
  if (!input) return "";
  let s = "";
  for (const ch of input) {
    s += TURKISH_MAP[ch] ?? ch;
  }
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

export function ensureUniqueSlug(
  base: string,
  existingSlugs: Iterable<string>,
): string {
  const taken = new Set<string>();
  for (const s of existingSlugs) {
    if (s) taken.add(s);
  }
  const root = slugify(base) || "project";
  if (!taken.has(root)) return root;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find unique slug for "${base}"`);
}
