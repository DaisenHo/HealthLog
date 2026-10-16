/**
 * Which statistic a type's DAY value is, and how days combine into a window.
 *
 * A watch samples heart rate about every 5 to 10 minutes at rest and about
 * every 5 seconds in a workout. A plain mean over a day's rows therefore counts
 * the workout hour hundreds of times and the other twenty-three hours a few
 * dozen times each, so a workout day reads far above the rest of the day.
 *
 * For such a type the DAY value is the mean of its per-hour means, each hour
 * weighing one. That is deterministic, needs no extra column, and matches what
 * an hourly bucket already is. A window of days then weighs each day once too
 * (the mean of the daily means), because weighting days by their sample count
 * would bring the same bias back one level up.
 *
 * Pulse only. A CGM samples glucose at a fixed rate, so glucose has no
 * activity bias; HRV and SpO2 can follow when the effect is shown on real data.
 */
import type { MeasurementType } from "@/generated/prisma/client";

export const HOURLY_MEAN_DAY_TYPES: ReadonlySet<MeasurementType> =
  new Set<MeasurementType>(["PULSE"]);

export function usesHourlyMeanDay(type: string): boolean {
  return HOURLY_MEAN_DAY_TYPES.has(type as MeasurementType);
}

/** How the days of a window combine: by sample count, or one weight per day. */
export type WindowWeighting = "count" | "day";

export function windowWeighting(type: string): WindowWeighting {
  return usesHourlyMeanDay(type) ? "day" : "count";
}

// ─── Pulse day-mean method (#1107 follow-up) ──────────────

/**
 * How the hours of a pulse day weigh against each other.
 *
 *   - `hour_mean_v1`: every hour that holds a reading weighs one, the
 *     statistic up to v1.42. One stray reading in an otherwise empty hour
 *     then counts as much as an hour of steady sampling.
 *   - `weighted_hour_mean_v2`: an hour with `n` readings weighs
 *     `min(1, n / SPARSE_HOUR_FULL_WEIGHT)`, so an hour reaches full weight
 *     at three readings and a lone reading weighs a third. A dense hour still
 *     weighs one, so the workout bias the hourly mean removed stays removed.
 *
 * The operator switches it once, after a dry run, from the admin console;
 * `app_settings.pulse_day_mean_method` holds it.
 */
export const PULSE_DAY_MEAN_METHODS = [
  "hour_mean_v1",
  "weighted_hour_mean_v2",
] as const;
export type PulseDayMeanMethod = (typeof PULSE_DAY_MEAN_METHODS)[number];

export const DEFAULT_PULSE_DAY_MEAN_METHOD: PulseDayMeanMethod = "hour_mean_v1";

/** Readings at which an hour reaches full weight under `weighted_hour_mean_v2`. */
export const SPARSE_HOUR_FULL_WEIGHT = 3;

export function isPulseDayMeanMethod(
  value: unknown,
): value is PulseDayMeanMethod {
  return (
    typeof value === "string" &&
    (PULSE_DAY_MEAN_METHODS as readonly string[]).includes(value)
  );
}

/** The weight of an hour holding `n` readings under `method`. */
export function hourWeight(n: number, method: PulseDayMeanMethod): number {
  if (method === "weighted_hour_mean_v2") {
    return Math.min(1, n / SPARSE_HOUR_FULL_WEIGHT);
  }
  return 1;
}

/**
 * The method this process applies. Every reader computes synchronously, so
 * the stored setting is mirrored here: loaded at boot and refreshed every
 * minute (`pulse-day-mean-method.ts`), set at once by the apply step in the
 * process that ran it. Pinned on `globalThis` because the boot hook and the
 * route handlers are separate bundles of one process. The default until the
 * first load is the v1.42 statistic, which is also what the column defaults
 * to.
 */
const METHOD_SYMBOL = Symbol.for("healthlog.pulseDayMeanMethod");

type GlobalWithMethod = typeof globalThis & {
  [METHOD_SYMBOL]?: PulseDayMeanMethod;
};

export function activePulseDayMeanMethod(): PulseDayMeanMethod {
  return (
    (globalThis as GlobalWithMethod)[METHOD_SYMBOL] ??
    DEFAULT_PULSE_DAY_MEAN_METHOD
  );
}

export function setActivePulseDayMeanMethod(method: PulseDayMeanMethod): void {
  (globalThis as GlobalWithMethod)[METHOD_SYMBOL] = method;
}
