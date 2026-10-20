/**
 * v1.13.x — the shared metric SIGNAL block.
 *
 * Every per-metric AI surface today sends the model raw graded buckets and
 * an instruction to "read the personal baseline from the means and compare
 * the two". That comparison is arithmetic an LLM does unreliably, and the
 * significance verdict ("is this inside my normal swing?") has no number to
 * anchor to — which is exactly where generic prose leaks in. The fix
 * (research-ai-quality.md §4) is a single token-lean, signal-RICH descriptor
 * that hands the model the comparison already finished:
 *
 *   metric · current · own baseline · signed delta (+%) · spread /
 *   normal-swing verdict · coarse normal-range placement · n / recency ·
 *   (for a composite score) the 1–2 biggest-moving contributors.
 *
 * This is "surface C" of the audit — the generic per-metric assessment base —
 * built first because it is also the per-score-assessment path.
 *
 * Pure + side-effect-free: it folds data the snapshot builders already hold
 * (the graded series, `summarizeSeries`, the registry norms, the profile).
 * No DB read, no provider call. The deterministic per-score assessment writer
 * and the generic metric-status snapshot both build their signal from here, so
 * one builder is the single source of the comparison every surface used to
 * re-derive by hand.
 */
import type { GradedSeries } from "@/lib/insights/graded-series";
import type { NormRange } from "@/lib/insights/derived/norms";
import { standardDeviation } from "@/lib/stats/spread";

/** Favourable-direction framing — mirrors the metric-status registry. */
export type MetricDirection = "higher-better" | "lower-better" | "target-band";

/** One contributor to a composite score (the Oura move for per-score cards). */
export interface MetricSignalContributor {
  /** Stable component key (e.g. "rhr", "sufficiency"). */
  key: string;
  /** 0..100 component score, or null when the input was missing. */
  value: number | null;
  /** Effective weight after null-redistribution, 0..1. */
  weight: number;
}

/**
 * The token-lean signal descriptor for one metric. Every numeric field is
 * pre-computed so the model states it rather than re-deriving it. Optional
 * fields are omitted (not nulled) when they do not apply, keeping the JSON
 * the prompt carries small.
 */
export interface MetricSignal {
  /** Natural-language label (no enum leak into prose). */
  metric: string;
  /** Unit string, when the metric has one. */
  unit?: string;
  /** Recent-window mean — the headline number (NOT a start/end value). */
  current: number;
  /** Days the recent window spans. */
  currentWindowDays: number;
  /** The user's OWN longer baseline (monthly mean, fallback weekly→yearly). */
  baseline: number | null;
  /** What the baseline IS, in words ("your 90-day average"). */
  baselineLabel?: string;
  /** Signed `current − baseline`, pre-computed. */
  delta: number | null;
  /** Signed percent change vs baseline, pre-computed. */
  deltaPct: number | null;
  /** Spread (SD) of the baseline window — the "normal swing". */
  spread: number | null;
  /** `|delta| > k·spread` — the significance verdict as a boolean, not a guess. */
  outsideNormalSwing: boolean | null;
  /** Favourable-direction framing. */
  direction: MetricDirection;
  /** Coarse population anchor (age/sex when sharpened), optional. */
  normalRange?: { low: number; high: number; source?: string };
  /** Pre-computed placement vs `normalRange`. */
  placement?: "below band" | "in band" | "above band";
  /** Sample count backing the recent window. */
  n: number;
  /** Recency of the newest reading, in days (null when unknown). */
  newestDaysAgo: number | null;
  /** For composite/derived SCORES only — the 1–2 biggest-moving contributors. */
  contributors?: MetricSignalContributor[];
}

/** `k` in `|delta| > k·spread`. One spread of deviation is the finding floor. */
export const NORMAL_SWING_K = 1;

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Mean of a numeric array, or null when empty. */
function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Placement of a value against a coarse normal range. */
export function placeInBand(
  value: number,
  range: { low: number; high: number },
): "below band" | "in band" | "above band" {
  if (value < range.low) return "below band";
  if (value > range.high) return "above band";
  return "in band";
}

export interface BuildMetricSignalArgs {
  /** Natural-language metric label. */
  metric: string;
  unit?: string;
  direction: MetricDirection;
  /** The graded snapshot the surface already built. */
  graded: GradedSeries;
  /** Coarse normal range (sharpened by age/sex upstream), optional. */
  normalRange?: NormRange | null;
  /** Where the normal range came from, for the `source` annotation. */
  normalRangeSource?: string;
  /** Newest-reading recency, in days, when known. */
  newestDaysAgo?: number | null;
}

/**
 * Build the §4.1 signal block from a graded series.
 *
 * - `current` = mean of the recent daily means (the short window).
 * - `baseline` = mean of the monthly means, falling back to weekly then
 *   yearly when the longer slices are empty (short history). When NO longer
 *   slice exists the baseline is null and the deltas/verdict are null too —
 *   an honest "no baseline yet" rather than a fabricated comparison.
 * - `spread` = SD of the baseline window's means (the normal swing).
 * - `outsideNormalSwing` = `|delta| > k·spread`.
 *
 * Returns null only when the recent window itself is empty (no current value
 * to anchor on) — the caller then skips the signal block entirely.
 */
export function buildMetricSignal(
  args: BuildMetricSignalArgs,
): MetricSignal | null {
  const { graded } = args;
  const recentMeans = graded.recent.map((b) => b.mean);
  const current = meanOf(recentMeans);
  if (current === null) return null;

  const recentN = graded.recent.reduce((s, b) => s + b.n, 0);

  // The longer baseline: monthly means first (the audit's canonical own
  // baseline), then weekly, then yearly — whichever the history supports.
  let baselineMeans: number[] = graded.monthly.map((b) => b.mean);
  let baselineLabel = "your monthly average";
  if (baselineMeans.length === 0) {
    baselineMeans = graded.weekly.map((b) => b.mean);
    baselineLabel = "your recent-weeks average";
  }
  if (baselineMeans.length === 0) {
    baselineMeans = graded.yearly.map((b) => b.mean);
    baselineLabel = "your long-term average";
  }

  const baseline = meanOf(baselineMeans);
  // The spread decides the verdict, so it is the sample estimate.
  const spread = standardDeviation(baselineMeans, "sample");

  let delta: number | null = null;
  let deltaPct: number | null = null;
  let outsideNormalSwing: boolean | null = null;
  if (baseline !== null) {
    delta = round(current - baseline, 2);
    deltaPct =
      baseline !== 0 ? round(((current - baseline) / baseline) * 100, 1) : null;
    if (spread !== null && spread > 0) {
      outsideNormalSwing =
        Math.abs(current - baseline) > NORMAL_SWING_K * spread;
    } else {
      // No usable spread (a flat or single-point baseline): a non-zero delta
      // is the only signal we can honestly give — treat any real change as
      // outside the (zero) swing, an exact match as inside it.
      outsideNormalSwing = delta !== 0;
    }
  }

  const signal: MetricSignal = {
    metric: args.metric,
    ...(args.unit ? { unit: args.unit } : {}),
    current: round(current, 2),
    currentWindowDays: graded.recent.length,
    baseline: baseline !== null ? round(baseline, 2) : null,
    ...(baseline !== null ? { baselineLabel } : {}),
    delta,
    deltaPct,
    spread: spread !== null ? round(spread, 2) : null,
    outsideNormalSwing,
    direction: args.direction,
    n: recentN,
    newestDaysAgo: args.newestDaysAgo ?? null,
  };

  if (args.normalRange) {
    signal.normalRange = {
      low: args.normalRange.low,
      high: args.normalRange.high,
      ...(args.normalRangeSource ? { source: args.normalRangeSource } : {}),
    };
    signal.placement = placeInBand(round(current, 2), {
      low: args.normalRange.low,
      high: args.normalRange.high,
    });
  }

  return signal;
}
