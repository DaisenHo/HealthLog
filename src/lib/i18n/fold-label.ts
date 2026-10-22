/**
 * The match form of a label, without the catalogs.
 *
 * `localised-label-index.ts` builds its indexes from every shipped catalog
 * and is server-only; this fold is the part client code needs too (the
 * medication target map folds a free-text name the same way), so it lives
 * in a leaf that imports nothing.
 */

/**
 * Letters Unicode decomposition leaves alone because their mark is part of
 * the glyph rather than a combining character — a stroke, or a ligature. NFKD
 * turns "ż" into "z" + a dot but leaves "ł" whole, so Polish would fold half
 * way without this. Expressed as ASCII equivalents, the same target the
 * combining-mark strip below produces.
 */
const UNDECOMPOSED_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ł/g, "l"],
  [/ø/g, "o"],
  [/đ/g, "d"],
  [/ß/g, "ss"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
];

/**
 * Fold a label or a free-text term to its match form: compatibility-normalised
 * (so "VO₂" and "VO2" agree), diacritics stripped (so "Glycémie" answers to
 * "glycemie" and "Siła" to "sila"), lower-cased, and every run of
 * non-alphanumerics collapsed to a single `_` with the ends trimmed (so
 * "Pain (0–10)" and "pain 0 10" agree).
 *
 * Applied to BOTH sides of every comparison — a bundle label and the caller's
 * word go through the same function, so the index cannot drift from the lookup.
 */
export function foldLabel(raw: string): string {
  let folded = raw
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  for (const [pattern, ascii] of UNDECOMPOSED_LETTERS) {
    folded = folded.replace(pattern, ascii);
  }
  return folded.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/gu, "");
}
