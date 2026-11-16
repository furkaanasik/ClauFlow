/**
 * Turkish accusative suffix for a task key ("CLF-2" → "CLF-2'yi"), zincir §3/15.
 * The suffix follows how the trailing number is read aloud: the last spoken
 * word decides vowel harmony and whether a buffer "y" is needed
 * (iki → 'yi, üç → 'ü, altı → 'yı, on → 'u, kırk → 'ı, yüz → 'ü, bin → 'i).
 * Pure, no imports.
 */

/** Spoken word for a non-zero digit, and for a non-zero tens digit. */
const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

/** The last word of the number as read aloud ("1000" → "bin", "40" → "kırk"). */
function lastSpokenWord(n: bigint): string {
  if (n === BigInt(0)) return "sıfır";
  const ten = BigInt(10);
  const ones = Number(n % ten);
  if (ones !== 0) return ONES[ones]!;
  const tens = Number((n / ten) % ten);
  if (tens !== 0) return TENS[tens]!;
  if ((n / BigInt(100)) % ten !== BigInt(0)) return "yüz";
  // Thousands and above: the scale word is spoken last ("2000" → "iki bin").
  const scales: Array<[bigint, string]> = [
    [BigInt(1_000), "bin"],
    [BigInt(1_000_000), "milyon"],
    [BigInt(1_000_000_000), "milyar"],
  ];
  let word = "bin";
  for (const [size, name] of scales) {
    if (n % size === BigInt(0)) word = name;
  }
  return word;
}

const VOWELS = "aeıioöuü";

/** Suffix for a word: harmony from its last vowel, "y" after a final vowel. */
function suffixFor(word: string): string {
  const lower = word.toLocaleLowerCase("tr");
  let last = "";
  for (const ch of lower) if (VOWELS.includes(ch)) last = ch;
  const vowel = last === "a" || last === "ı" ? "ı" : last === "o" || last === "u" ? "u" : last === "ö" || last === "ü" ? "ü" : "i";
  const endsWithVowel = VOWELS.includes(lower.at(-1) ?? "");
  return `'${endsWithVowel ? "y" : ""}${vowel}`;
}

/** "CLF-2" → "CLF-2'yi", "CLF-10" → "CLF-10'u"; a key without a trailing number follows its last letters. */
export function accusative(displayId: string): string {
  const m = /(\d+)$/.exec(displayId);
  const word = m ? lastSpokenWord(BigInt(m[1]!)) : displayId;
  return `${displayId}${suffixFor(word)}`;
}
