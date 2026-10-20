/**
 * v1.21.2 — the score-card narrative block for the dashboard /
 * insights hero.
 *
 * Two server-resolved, DTO-only signals the `HealthScoreCard` renders but never
 * recomputes:
 *
 *   - `tension` (A5) — the honest "internal read" when the readiness composite's
 *     contributors DISAGREE (good sleep but a rising resting pulse, …). Reuses
 *     the SAME readiness components the wellness ring grades + the SAME
 *     `deriveTension` disagreement detector the Coach snapshot uses, so the card
 *     and the Coach never narrate two different verdicts. Clinical-floors
 *     override: when a real clinical red-flag is in play (the coincident-
 *     deviation flag fired WITHOUT an illness explanation) the tension is
 *     SUPPRESSED (`null`) so the red-flag path dominates — a red-flag is never
 *     reconciled away into a calm verdict.
 *
 *   - `returnToBand` (A6) — present only when a salient metric has come BACK
 *     inside the user's OWN personal range after a prior out-of-band run. Runs
 *     the pure `detectStreak` engine across the salient vitals and surfaces AT
 *     MOST ONE (the most salient return). Actively closes a worry rather than
 *     reporting a number.
 *
 * Both omit (return `null`) rather than guess: tension stays quiet on a coherent
 * day, `returnToBand` requires a genuine prior out-of-band run. The block is
 * LOCALE-AGNOSTIC — it emits contributor KEYS + a metric TYPE; the client
 * localises them through the existing readiness-contributor + metric-name i18n
 * keys before handing the card its already-localised strings. iOS rides the same
 * DTO and resolves its own labels.
 *
 * Server-only — reads `@/lib/db` transitively through the derived engines.
 */
import type { MeasurementType } from "@/generated/prisma/client";
import {
  computeReadiness,
  computeCoincidentDeviation,
  isDerivedOk,
  type BaselineProfile,
  type ReadinessComponentKey,
} from "@/lib/insights/derived";
import { readDayMeanSeries } from "@/lib/insights/derived/baseline";
import {
  deriveTension,
  TENSION_HIGH_SCORE,
  TENSION_LOW_SCORE,
} from "@/lib/ai/coach/derived-snapshot";
import { detectStreak, type StreakPoint } from "@/lib/insights/streak-detector";
import { probeRollupCoverage } from "@/lib/rollups/measurement-coverage";

/**
 * The Tension Verdict in its locale-agnostic DTO shape. `band` is the readiness
 * composite's band; `positive` / `negative` carry the readiness contributor
 * KEYS (`rhr` / `hrv` / `sleep` / `respiratory` / `mood`) so the client maps
 * each to its localised display label. Null when the contributors agree (no
 * tension) or when a clinical red-flag suppresses it.
 */
export interface ScoreTensionDto {
  band: "green" | "yellow" | "red";
  positive: ReadinessComponentKey[];
  negative: ReadinessComponentKey[];
}

/**
 * The return-to-baseline event in its locale-agnostic DTO shape. `metricType`
 * is the `MeasurementType` the client maps to its localised metric name;
 * `daysInside` is how long the metric has now sat back inside its personal range.
 * Null when no salient metric has returned from a genuine prior out-of-band run.
 */
export interface ScoreReturnToBandDto {
  metricType: MeasurementType;
  daysInside: number;
}

export interface ScoreNarrativeBlock {
  tension: ScoreTensionDto | null;
  returnToBand: ScoreReturnToBandDto | null;
}

/** The deviation-from-baseline vitals worth a return-to-baseline surface. */
const RETURN_SALIENT_TYPES: MeasurementType[] = [
  "RESTING_HEART_RATE",
  "HEART_RATE_VARIABILITY",
  "RESPIRATORY_RATE",
  "WEIGHT",
];

/** Trailing window the streak detector reads per metric (matches the band engine). */
const RETURN_WINDOW_DAYS = 30;

/** A band is one of green / yellow / red. Narrow the readiness band string. */
function narrowBand(
  band: string | undefined,
): "green" | "yellow" | "red" | undefined {
  return band === "green" || band === "yellow" || band === "red"
    ? band
    : undefined;
}

/**
 * Build the score-card narrative block. Both signals are computed concurrently
 * and fail-soft to `null` so a transient read never sinks the snapshot.
 *
 * `coverage` is the per-request coverage map the caller already probed (the
 * snapshot probes it once up front); when omitted the helper probes itself so
 * it is independently callable.
 */
export async function buildScoreNarrativeBlock(
  userId: string,
  profile: BaselineProfile,
  now: Date,
  tz: string,
  coverage?: Awaited<ReturnType<typeof probeRollupCoverage>>,
): Promise<ScoreNarrativeBlock> {
  // `readDayMeanSeries` (the streak series source) requires a coverage map, so
  // probe once here when the caller did not supply one. A probe failure leaves
  // `returnToBand` quiet rather than guessing.
  const cov = coverage ?? (await probeRollupCoverage(userId).catch(() => null));

  const [tension, returnToBand] = await Promise.all([
    buildTension(userId, profile, now, tz, cov).catch(() => null),
    cov
      ? buildReturnToBand(userId, now, cov).catch(() => null)
      : Promise.resolve(null),
  ]);

  return { tension, returnToBand };
}

/**
 * Resolve the Tension Verdict from the readiness contributors + the clinical
 * override. Reuses `computeReadiness` (the same engine the wellness ring grades)
 * and the shared `deriveTension` detector; the clinical override fires when the
 * coincident-deviation flag fired WITHOUT an illness explanation.
 */
async function buildTension(
  userId: string,
  profile: BaselineProfile,
  now: Date,
  tz: string,
  coverage: Awaited<ReturnType<typeof probeRollupCoverage>> | null,
): Promise<ScoreTensionDto | null> {
  const readinessOpts = {
    now,
    tz,
    ...(coverage ? { coverage } : {}),
  };
  // The coincident-deviation flag carries the clinical-override bit. Fail-soft
  // to "no override" so a baseline hiccup never fabricates a red-flag suppress.
  const [readiness, coincident] = await Promise.all([
    computeReadiness(userId, profile, readinessOpts),
    computeCoincidentDeviation(userId, profile, {
      now,
      ...(tz ? { tz } : {}),
    }).catch(() => null),
  ]);

  if (!isDerivedOk(readiness)) return null;

  const components = readiness.value.components;
  const band = narrowBand(readiness.value.band);

  const coincidentFired =
    coincident !== null && isDerivedOk(coincident) && coincident.value.fired;
  // A real clinical red-flag is in play when the coincident-deviation flag fired
  // WITHOUT an illness explanation.
  const clinicalOverride =
    coincidentFired && !coincident.value.illnessExplained;

  // CLINICAL-FLOORS OVERRIDE — when a real red-flag is in play the card must NOT
  // render a calm reconciled tension verdict: suppress it (`null`) so the
  // red-flag path dominates. A red-flag is never reconciled away.
  if (clinicalOverride) return null;

  // Reuse the shared `deriveTension` detector for the authoritative fire
  // decision (same disagreement thresholds the Coach narrates). It emits ENGLISH
  // display labels; we consume only its DECISION and re-derive the contributor
  // KEY lists from the SAME components against the SAME exported thresholds, so
  // the client can localise. `clinicalOverride: false` here — the suppress above
  // already handled the red-flag case.
  const decision = deriveTension(
    components.map((c) => ({ key: c.key, value: c.value })),
    band,
    false,
  );
  if (!decision) return null;

  const positive: ReadinessComponentKey[] = [];
  const negative: ReadinessComponentKey[] = [];
  for (const c of components) {
    if (c.value === null) continue;
    if (c.value >= TENSION_HIGH_SCORE) positive.push(c.key);
    else if (c.value <= TENSION_LOW_SCORE) negative.push(c.key);
  }

  return {
    band: narrowBand(decision.band) ?? "yellow",
    positive,
    negative,
  };
}

/**
 * Run the return-to-baseline detector across the salient vitals and surface AT
 * MOST ONE — the most salient return. Salience ranks the longer prior
 * out-of-band run first (the bigger worry to close), then the longer in-band
 * run, then the canonical metric order as a deterministic tie-break.
 */
async function buildReturnToBand(
  userId: string,
  now: Date,
  coverage: Awaited<ReturnType<typeof probeRollupCoverage>>,
): Promise<ScoreReturnToBandDto | null> {
  const candidates = await Promise.all(
    RETURN_SALIENT_TYPES.map(async (type, order) => {
      try {
        const { points } = await readDayMeanSeries(
          userId,
          type,
          RETURN_WINDOW_DAYS,
          now,
          coverage,
        );
        if (points.length === 0) return null;
        const series: StreakPoint[] = points.map((p) => ({
          day: p.day,
          value: p.mean,
        }));
        const result = detectStreak(series);
        if (!result.returnEvent) return null;
        return {
          type,
          order,
          daysInside: result.returnEvent.daysInside,
          priorDaysOutside: result.returnEvent.priorDaysOutside,
        };
      } catch {
        return null;
      }
    }),
  );

  const returned = candidates.filter(
    (c): c is NonNullable<typeof c> => c !== null,
  );
  if (returned.length === 0) return null;

  returned.sort(
    (a, b) =>
      b.priorDaysOutside - a.priorDaysOutside ||
      b.daysInside - a.daysInside ||
      a.order - b.order,
  );
  const top = returned[0];
  return { metricType: top.type, daysInside: top.daysInside };
}
