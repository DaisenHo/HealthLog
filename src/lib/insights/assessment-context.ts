/**
 * v1.12.1 — assessment-context helpers for the per-metric Insights cards.
 *
 * The per-metric assessment prompt is tightly grounded but its *form* used
 * to converge: every card opened the same way, forced the same "one doable
 * step", and a metric that stayed steady for weeks produced near-identical
 * paragraphs. None of that is a grounding or safety problem — it is a
 * diversity / repetition problem, fixable with signals already computed
 * server-side. This module turns those signals into small, locale-aware
 * prompt blocks the generator interpolates:
 *
 *   - a deterministic per-render VARIETY token (lead-with-trend vs
 *     lead-with-latest vs lead-with-consistency) so consecutive cards and
 *     consecutive days don't read the same. Seeded from
 *     `userId + metricId + dayKey` (NOT Math.random / Date.now — those are
 *     unavailable on this codebase's deterministic paths) so it is stable
 *     per render and unit-testable.
 *   - an explicit DATA STRENGTH line (n + recency) so the prose hedges on
 *     thin data instead of the model guessing what "few" means.
 *   - a REPETITION line ("you've reported 'steady' N times running") so the
 *     model varies or escalates instead of restating the same level.
 *   - a RELATIONS block carrying the FDR-surviving cross-metric correlations
 *     that involve THIS metric — already computed by the discovery engine,
 *     previously only surfaced in the period narrative.
 *
 * Everything here is PURE: callers fetch the data, this module formats it.
 * No grounding floor is touched — these blocks add context, they never relax
 * the own-baseline rule, the computed-stats rule, or the filler-phrase ban.
 */
import type { Locale } from "@/lib/i18n/config";

/**
 * Three rhetorical entry points the card can lead with. The grounding is
 * identical in every case — only the opening *angle* rotates, so a user
 * paging through ten metric cards doesn't read ten identically-shaped
 * paragraphs.
 */
export type VarietyLead = "trend" | "latest" | "consistency";

const VARIETY_LEADS: readonly VarietyLead[] = [
  "trend",
  "latest",
  "consistency",
] as const;

/**
 * Deterministic 32-bit FNV-1a hash. Stable across processes (no salt, no
 * platform dependence), so the same `(userId, metricId, dayKey)` always
 * picks the same lead — which makes the variety token reproducible and
 * directly unit-testable, and keeps a render idempotent within a day.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by the FNV prime (0x01000193) in 32-bit space.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to an unsigned 32-bit integer.
  return hash >>> 0;
}

/**
 * Pick the per-render variety lead for this user × metric × day. Stable
 * (seeded, not random) so the same card re-renders identically within a
 * day, but rotates across metrics and across days.
 */
export function pickVarietyLead(
  userId: string,
  metricId: string,
  dayKey: string,
): VarietyLead {
  const seed = fnv1a(`${userId}|${metricId}|${dayKey}`);
  return VARIETY_LEADS[seed % VARIETY_LEADS.length];
}

/**
 * One short locale-aware hint nudging the opening angle. Kept advisory
 * ("you may open with …") so it never overrides the grounding rules when
 * the data makes a different lead the honest one.
 */
export function formatVarietyHint(lead: VarietyLead, locale: Locale): string {
  if (locale === "en") {
    const angle =
      lead === "trend"
        ? "the recent direction of travel (rising / falling / flat vs the baseline)"
        : lead === "latest"
          ? "the single most recent value and where it sits"
          : "how consistent or variable the readings have been";
    return `VARIETY: to keep your cards from reading the same, you may open this one by leading with ${angle} — only if the data genuinely supports that angle; never force it, never invent a trend.`;
  }
  const angle =
    lead === "trend"
      ? "der jüngsten Richtung (steigend / fallend / flach gegenüber der Baseline)"
      : lead === "latest"
        ? "dem aktuellsten Einzelwert und seiner Einordnung"
        : "der Konstanz bzw. Streuung der Werte";
  return `ABWECHSLUNG: damit deine Karten nicht gleich klingen, darfst du diese mit ${angle} eröffnen — nur wenn die Daten diesen Blickwinkel wirklich tragen; nie erzwingen, nie einen Trend erfinden.`;
}

/**
 * Surface the computed data strength (n + recency) explicitly so the prose
 * and the UI confidence badge agree. The base prompt already tells the
 * model to be honest about thin data but leaves "few" undefined; this pins
 * the numbers the model would otherwise have to guess at.
 *
 * `points` is the number of daily buckets in the read window;
 * `newestDaysAgo` is how stale the most recent reading is (null when none).
 */
export function formatDataStrength(
  args: { points: number; newestDaysAgo: number | null },
  locale: Locale,
): string {
  const { points, newestDaysAgo } = args;
  const thin = points < 7;
  const stale = newestDaysAgo != null && newestDaysAgo > 7;
  if (locale === "en") {
    const recency =
      newestDaysAgo == null
        ? "no dated reading"
        : newestDaysAgo <= 0
          ? "latest reading today"
          : newestDaysAgo === 1
            ? "latest reading 1 day ago"
            : `latest reading ${newestDaysAgo} days ago`;
    const guidance = thin
      ? " — too few points for a reliable trend; hedge accordingly and avoid claiming a direction."
      : stale
        ? " — the data is going stale; note that the picture may be out of date."
        : "";
    return `DATA STRENGTH: ${points} day-buckets in the window, ${recency}.${guidance}`;
  }
  const recency =
    newestDaysAgo == null
      ? "kein datierter Wert"
      : newestDaysAgo <= 0
        ? "letzter Wert heute"
        : newestDaysAgo === 1
          ? "letzter Wert vor 1 Tag"
          : `letzter Wert vor ${newestDaysAgo} Tagen`;
  const guidance = thin
    ? " — zu wenige Punkte für einen belastbaren Trend; entsprechend vorsichtig formulieren, keine Richtung behaupten."
    : stale
      ? " — die Daten veralten; weise darauf hin, dass das Bild nicht mehr aktuell sein könnte."
      : "";
  return `DATENLAGE: ${points} Tages-Buckets im Fenster, ${recency}.${guidance}`;
}

/**
 * Repetition signal — how many of the most recent assessments in a row
 * carried the same direction/classification. Drives the model to vary or
 * escalate ("still steady, 3rd week running — let's look at a different
 * facet") instead of restating the same level verbatim.
 *
 * `repeatCount` is the run length of same-classification prior assessments
 * (0 when this is the first, or when the last assessment differed).
 */
export function formatRepetitionSignal(
  repeatCount: number,
  locale: Locale,
): string {
  if (repeatCount <= 0) {
    // No run to call out — stay silent so the block adds no noise.
    return "";
  }
  if (locale === "en") {
    return `REPETITION: you have already given a similar "no material change" assessment for this metric ${repeatCount} time(s) in a row. Do NOT restate the same level again. Acknowledge the continuity in one short clause ("still holding steady, ${repeatCount + 1} checks running") and then pivot to a DIFFERENT facet — consistency, time-of-day pattern, or a correlated metric — or, if nothing is genuinely actionable, say so plainly and skip the manufactured step.`;
  }
  return `WIEDERHOLUNG: du hast für diese Metrik bereits ${repeatCount}-mal in Folge eine ähnliche "keine wesentliche Änderung"-Einschätzung gegeben. Wiederhole NICHT erneut dasselbe Niveau. Benenne die Kontinuität in einem kurzen Nebensatz ("weiterhin stabil, ${repeatCount + 1} Checks in Folge") und wende dich dann einem ANDEREN Aspekt zu — Konstanz, Tageszeit-Muster oder einer korrelierten Metrik — oder sage, falls nichts wirklich umsetzbar ist, dies klar und lass den erzwungenen Schritt weg.`;
}

/**
 * Compute the "steady run" length from the graded series alone — how many
 * of the most recent weekly buckets in a row sit within a small band of the
 * user's own longer baseline. This is the grounded, computed-not-stored
 * proxy for "you've already noted this is steady N times": it derives the
 * repetition signal from the same graded data the model sees, so there is
 * no new persistence and no fragile prose-similarity matching.
 *
 * Returns 0 when the picture is NOT steady (most recent week deviates) or
 * when there are too few weekly buckets to judge — in both cases the
 * repetition block stays silent and the model proceeds normally.
 *
 * `weekly` / `monthly` are the graded-series slices (ascending: oldest →
 * newest). `bandFraction` is the relative tolerance around the baseline
 * mean that still counts as "no material change" (default 8 %).
 */
export function computeSteadyRun(
  weekly: ReadonlyArray<{ mean: number }> | undefined,
  monthly: ReadonlyArray<{ mean: number }> | undefined,
  bandFraction = 0.08,
): number {
  // Defensive: a graded slice can be absent on a degraded / stubbed series.
  // Treat a missing slice as no signal so the repetition block stays silent.
  if (!weekly || !monthly) return 0;
  if (weekly.length < 2) return 0;

  // Baseline: the longer-horizon mean the recent weeks are placed against.
  // Prefer the monthly means; fall back to the full weekly mean when no
  // monthly history exists yet.
  const baselineSource = monthly.length > 0 ? monthly : weekly;
  const baseline =
    baselineSource.reduce((sum, b) => sum + b.mean, 0) / baselineSource.length;
  if (!Number.isFinite(baseline) || baseline === 0) return 0;

  const band = Math.abs(baseline) * bandFraction;

  // Walk newest → oldest, counting consecutive weeks within the band.
  let run = 0;
  for (let i = weekly.length - 1; i >= 0; i--) {
    if (Math.abs(weekly[i].mean - baseline) <= band) {
      run += 1;
    } else {
      break;
    }
  }
  // A run of 1 is not yet repetition worth flagging; report 0 so the block
  // only fires once the steadiness has actually persisted.
  return run >= 2 ? run : 0;
}

/**
 * A single FDR-surviving correlation that involves the current metric,
 * reduced to the conservative descriptive `interpretation` string the
 * discovery engine already produced (never causal) plus its n and r for
 * the model to weigh.
 */
export interface RelevantCorrelation {
  interpretation: string;
  n: number;
  r: number;
}

/**
 * Format the cross-metric RELATIONS block. The interpretation strings are
 * passed VERBATIM — they are the engine's conservative, descriptive,
 * never-causal phrasings, already FDR-controlled. The instruction reminds
 * the model these are associations, optional to mention, and must never be
 * recast as causes or have their numbers altered.
 */
export function formatRelationsBlock(
  correlations: RelevantCorrelation[],
  locale: Locale,
): string {
  if (correlations.length === 0) return "";
  // Cap at two so the block never crowds out the metric's own grounding.
  const top = correlations.slice(0, 2);
  const lines = top.map(
    // eslint-disable-next-line healthlog/no-unlocalised-decimal -- text for the model, never shown to a person
    (c) => `- ${c.interpretation} (n=${c.n}, r=${c.r.toFixed(2)})`,
  );
  if (locale === "en") {
    return [
      "RELATIONS (statistically-screened associations in YOUR data involving this metric — descriptive, NEVER causal):",
      ...lines,
      'You MAY weave at most ONE of these in if it adds genuine insight, phrased as an "association" / "tends to go with" — never as a cause, and never alter the numbers. Skip them if the metric\'s own finding is the stronger story.',
    ].join("\n");
  }
  return [
    "ZUSAMMENHÄNGE (statistisch geprüfte Assoziationen in DEINEN Daten, die diese Metrik betreffen — beschreibend, NIE kausal):",
    ...lines,
    'Du DARFST höchstens EINEN davon einflechten, wenn er echten Mehrwert bringt — als "Zusammenhang" / "geht tendenziell einher mit" formuliert, nie als Ursache, und ohne die Zahlen zu verändern. Lass sie weg, wenn der eigene Befund der Metrik die stärkere Geschichte ist.',
  ].join("\n");
}

/**
 * Assemble the optional context blocks into one string the user prompt
 * appends after the previous-context block. Empty blocks drop out, so a
 * first-run thin-data metric with no correlations adds nothing.
 */
export function buildAssessmentContextBlock(
  args: {
    varietyLead: VarietyLead;
    dataStrength: { points: number; newestDaysAgo: number | null };
    repeatCount: number;
    relations: RelevantCorrelation[];
  },
  locale: Locale,
): string {
  const parts = [
    formatVarietyHint(args.varietyLead, locale),
    formatDataStrength(args.dataStrength, locale),
    formatRepetitionSignal(args.repeatCount, locale),
    formatRelationsBlock(args.relations, locale),
  ].filter((p) => p.trim().length > 0);
  return parts.join("\n\n");
}
