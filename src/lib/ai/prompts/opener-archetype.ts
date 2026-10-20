/**
 * v1.22 — deterministic opener-archetype rotation + hash helpers.
 *
 * The narrative weakness the maintainer reports ("every text is structured the
 * same way") is structural: the per-metric card, the briefing, and the score
 * card each open with the same shape every time. The fix is variety WITHOUT
 * randomness — a stable hash over a per-(user, metric, day) key picks one of a
 * small set of opener archetypes, so:
 *   - consecutive cards / consecutive days open differently, and
 *   - the choice is reproducible (unit-testable, no RNG, no cross-day state).
 *
 * The archetype is injected into the prompt as a one-line HINT, never a hard
 * template — the model still writes freely and every grounding verifier stays
 * untouched (this changes opener SHAPE, not which numbers are allowed). The
 * same hash also drives the sparse, anti-formulaic name personalization
 * (`shouldUseNameForTurn`) and a day-rotated sampling seed
 * (`dayRotatedSeed`) that replaces the fixed reference seed on the narrative
 * surfaces so weekly / monthly / score prose varies run-to-run.
 *
 * Pure + side-effect-free — it imports only the locale type and unit-tests in
 * isolation.
 */
import type { Locale } from "@/lib/i18n/config";

/** The opener archetypes, in a fixed order so the index map is stable. */
export const OPENER_ARCHETYPES = [
  "VERDICT",
  "TREND",
  "CONTRAST",
  "CONTINUITY",
  "MEANING",
] as const;

export type OpenerArchetype = (typeof OPENER_ARCHETYPES)[number];

/**
 * 32-bit FNV-1a hash of a string. Deterministic, dependency-free, and stable
 * across processes (no `Math.random`, no `Date.now`). Returns an unsigned
 * 32-bit integer so the modulo math below is sign-safe.
 */
export function hashSeedKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    // h *= 16777619, kept in 32-bit space via the shift-add decomposition.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick one opener archetype for a stable key (`<userId>:<metric>:<dayKey>` or
 * `<userId>:<turnIndex>`). Same key → same archetype; different metric or day
 * → (usually) a different one, so cards and days don't all open the same way.
 */
export function pickOpenerArchetype(seedKey: string): OpenerArchetype {
  return OPENER_ARCHETYPES[hashSeedKey(seedKey) % OPENER_ARCHETYPES.length];
}

/** The one-line opener HINT (not a template) injected into the user prompt. */
const ARCHETYPE_HINT: Record<OpenerArchetype, Record<"en" | "de", string>> = {
  VERDICT: {
    en: "Open with the overall read in plain words, then bring in the number as support — not number-first.",
    de: "Eröffne mit dem Gesamteindruck in klaren Worten und bring die Zahl danach als Beleg — nicht zahlen-zuerst.",
  },
  TREND: {
    en: "Open with the direction of change over time, then say where it stands now.",
    de: "Eröffne mit der Richtung der Veränderung über die Zeit und nenne dann den aktuellen Stand.",
  },
  CONTRAST: {
    en: "Open by contrasting now against the user's own baseline.",
    de: "Eröffne mit dem Kontrast zwischen jetzt und der eigenen Baseline des Nutzers.",
  },
  CONTINUITY: {
    en: "Open by acknowledging steadiness or a streak, then the current value.",
    de: "Eröffne mit der Anerkennung von Konstanz oder einer Serie und dann dem aktuellen Wert.",
  },
  MEANING: {
    en: "Open with what this means for the user today, then the number behind it.",
    de: "Eröffne damit, was das heute für den Nutzer bedeutet, und dann die Zahl dahinter.",
  },
};

/**
 * Resolve the opener-archetype hint line for a seed key + locale. EN/DE are
 * hand-composed; every other locale rides the EN hint (the hint is internal
 * scaffolding, not user-facing prose, so it does not need native wording).
 */
export function openerArchetypeHint(seedKey: string, locale: Locale): string {
  const archetype = pickOpenerArchetype(seedKey);
  const loc = locale === "de" ? "de" : "en";
  return ARCHETYPE_HINT[archetype][loc];
}

/**
 * Anti-formulaic name gate. Returns true on roughly 1-in-3 keys, so the Coach /
 * briefing uses the user's first name occasionally and varied rather than as a
 * rote per-turn greeting. Deterministic per key (testable); the caller mixes
 * the turn index / day into the key so the cadence is unpredictable but stable.
 */
export function shouldUseNameForTurn(seedKey: string): boolean {
  return hashSeedKey(seedKey) % 3 === 0;
}

/**
 * Derive a person's first name from a stored display name — the first
 * whitespace-delimited token, trimmed. Returns null for an empty / whitespace /
 * null input so the caller can omit the name clause entirely (never a blank
 * name). Kept here so the route and the briefing share one definition.
 */
export function firstNameFromDisplayName(
  displayName: string | null | undefined,
): string | null {
  if (!displayName) return null;
  const token = displayName.trim().split(/\s+/)[0] ?? "";
  return token.length > 0 ? token : null;
}

/**
 * Day-rotated sampling seed. Replaces the fixed reference seed on the narrative
 * surfaces so the prose varies day-to-day while staying deterministic within a
 * day (so a test fixing the key + day gets reproducible output). Bounded to a
 * positive 31-bit integer, the safe range every seed-aware provider accepts.
 */
export function dayRotatedSeed(seedKey: string): number {
  return hashSeedKey(seedKey) % 2_000_000_000;
}
