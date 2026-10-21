/**
 * The medication effect as an interrupted time series: the target metric's
 * daily values over a window around the start, fitted with a segmented
 * regression (level change + slope change, Newey–West intervals).
 *
 * Adherence-adjusted by exclusion. After the start, a day is left out when the
 * doses expected over the trailing fourteen days were taken less than 80 % of
 * the time, and when the medication was paused or between courses that day.
 * The adherence comes from the cadence-aware dose ledger the compliance
 * surfaces read (`dailyComplianceRatesFromLedger`), never a recount. With
 * intake tracking off nothing is excluded and the DTO says so.
 *
 * The window is ninety days before the start and up to 180 after it, cut short
 * at the medication's own first dose change (the estimate then describes the
 * starting dose, not a blend of two). Other medications that started, stopped,
 * changed dose or paused inside the window are listed as caveats: the model
 * cannot tell their effect from this one.
 *
 * Descriptive and association-only, like the rest of the efficacy DTO: there
 * is no verdict field. The renderer phrases the numbers and the caveats; it
 * never decides whether a medication "works".
 *
 * Pure: the database reads live in `./load-segmented-effects.ts`, so the
 * client renderer can import the constants and types from here. Computed on
 * request, without AI.
 */
import { dayKeyOfDate } from "@/lib/medications/course-window";
import { userDayKey } from "@/lib/tz/format";
import { dayKeyAsUtcMidnight } from "@/lib/tz/date-only";
import {
  fitSegmentedRegression,
  type SegmentedEstimate,
} from "@/lib/stats/segmented-regression";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days of target data the window reaches back over before the start. */
export const SEGMENTED_PRE_WINDOW_DAYS = 90;
/** Days after the start the window reaches forward over, at most. */
export const SEGMENTED_POST_WINDOW_DAYS = 180;
/** Days with a value required on each side of the start. */
export const SEGMENTED_MIN_DAYS_PER_SIDE = 14;
/** Calendar span (first to last value) required on each side. */
export const SEGMENTED_MIN_SPAN_DAYS = 21;
/** Trailing window the per-day adherence is judged over. */
export const ADHERENCE_LOOKBACK_DAYS = 14;
/** Adherence below this share leaves a post-start day out. */
export const ADHERENCE_FLOOR = 0.8;
/** Confidence level of every interval. */
export const SEGMENTED_LEVEL = 0.95;

/** An estimate in display terms: the unit per day for a level, per week for a slope. */
export interface EfficacyEstimate {
  estimate: number;
  ciLow: number;
  ciHigh: number;
  standardError: number;
  /** True when the interval spans zero (the data is also consistent with no change). */
  includesZero: boolean;
}

export type EfficacyConfounderEvent =
  "started" | "stopped" | "dose_change" | "paused" | "resumed";

export interface EfficacyConfounder {
  medicationName: string;
  event: EfficacyConfounderEvent;
  /** YYYY-MM-DD. */
  date: string;
}

export interface EfficacySegmented {
  present: boolean;
  reason?:
    "no_start" | "insufficient_before" | "insufficient_after" | "fit_failed";
  /** Confidence level of the intervals (0.95). */
  level: number;
  /** The window actually fitted (YYYY-MM-DD, inclusive). */
  window: {
    from: string;
    to: string;
    endReason: "today" | "window" | "dose_change";
  } | null;
  /** Days with a value used on each side, and the days left out after the start. */
  days: {
    before: number;
    after: number;
    excludedLowAdherence: number;
    excludedNotTaking: number;
  };
  adherence: {
    /** "not_tracked" when the medication logs no intake, so nothing was excluded. */
    status: "tracked" | "not_tracked";
    floorPct: number;
    lookbackDays: number;
  };
  /** Immediate shift at the start, in the target's unit. */
  levelChange: EfficacyEstimate | null;
  /** Change in the weekly trend after the start, unit per week. */
  slopeChangePerWeek: EfficacyEstimate | null;
  /** The weekly trend before the start, unit per week. */
  preSlopePerWeek: EfficacyEstimate | null;
  fit: {
    n: number;
    df: number;
    rSquared: number;
    residualAutocorrelation: number;
    hacLag: number;
  } | null;
  /** Other medication changes inside the window, oldest first. */
  confounders: EfficacyConfounder[];
}

function dayIndex(day: string): number {
  return Math.round(dayKeyAsUtcMidnight(day).getTime() / DAY_MS);
}

function dayKeyOfIndex(index: number): string {
  return dayKeyOfDate(new Date(index * DAY_MS));
}

function scaled(e: SegmentedEstimate, factor: number): EfficacyEstimate {
  const ciLow = e.ciLow * factor;
  const ciHigh = e.ciHigh * factor;
  return {
    estimate: e.estimate * factor,
    ciLow,
    ciHigh,
    standardError: e.standardError * factor,
    includesZero: ciLow <= 0 && ciHigh >= 0,
  };
}

/** The input to the pure assembly — every day already a local day key. */
export interface SegmentedEffectInput {
  /** One value per local day (any order). */
  dayValues: ReadonlyArray<{ day: string; value: number }>;
  /** The start day, or null when the medication carries no start date. */
  pivotDay: string | null;
  /** The last day the window may reach (today, or a report's last day). */
  lastDay: string;
  /** Per-day dose tallies from the ledger; null when intake is not tracked. */
  adherenceDays: ReadonlyArray<{
    day: string;
    taken: number;
    missed: number;
  }> | null;
  /** Whether the medication was not being taken on a day (paused, between courses). */
  notTakingOn: (day: string) => boolean;
  /** The medication's own dose changes (YYYY-MM-DD). */
  ownDoseChangeDays: readonly string[];
  /** Other medications' changes (YYYY-MM-DD), any order. */
  otherMedicationEvents: readonly EfficacyConfounder[];
}

const EMPTY_DAYS = {
  before: 0,
  after: 0,
  excludedLowAdherence: 0,
  excludedNotTaking: 0,
};

/**
 * Assemble the segmented effect from already-resolved day data. Pure, so the
 * window, exclusion and minimum-data rules are testable without a database.
 */
export function buildSegmentedEffect(
  input: SegmentedEffectInput,
): EfficacySegmented {
  const adherence = {
    status: input.adherenceDays === null ? "not_tracked" : "tracked",
    floorPct: Math.round(ADHERENCE_FLOOR * 100),
    lookbackDays: ADHERENCE_LOOKBACK_DAYS,
  } as const;
  const absent = (
    reason: NonNullable<EfficacySegmented["reason"]>,
    window: EfficacySegmented["window"] = null,
    days = EMPTY_DAYS,
    confounders: EfficacyConfounder[] = [],
  ): EfficacySegmented => ({
    present: false,
    reason,
    level: SEGMENTED_LEVEL,
    window,
    days,
    adherence,
    levelChange: null,
    slopeChangePerWeek: null,
    preSlopePerWeek: null,
    fit: null,
    confounders,
  });

  if (input.pivotDay === null) return absent("no_start");

  const pivot = dayIndex(input.pivotDay);
  const from = pivot - SEGMENTED_PRE_WINDOW_DAYS;
  let to = Math.min(
    dayIndex(input.lastDay),
    pivot + SEGMENTED_POST_WINDOW_DAYS - 1,
  );
  let endReason: "today" | "window" | "dose_change" =
    to === dayIndex(input.lastDay) ? "today" : "window";
  // The first own dose change after the start ends the window the day
  // before it: one estimate per dose. A dose recorded on the start day is
  // the starting dose, not a change.
  const firstChange = input.ownDoseChangeDays
    .map(dayIndex)
    .filter((d) => d > pivot)
    .sort((a, b) => a - b)[0];
  if (firstChange !== undefined && firstChange - 1 < to) {
    to = firstChange - 1;
    endReason = "dose_change";
  }
  const window = {
    from: dayKeyOfIndex(from),
    to: dayKeyOfIndex(to),
    endReason,
  };

  const confounders = input.otherMedicationEvents
    .filter((c) => {
      const d = dayIndex(c.date);
      return d >= from && d <= to;
    })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  // Per-day adherence, judged over the trailing lookback.
  const adherenceByDay = new Map<number, { taken: number; missed: number }>();
  for (const a of input.adherenceDays ?? []) {
    adherenceByDay.set(dayIndex(a.day), { taken: a.taken, missed: a.missed });
  }
  const lowAdherenceOn = (d: number): boolean => {
    if (input.adherenceDays === null) return false;
    let taken = 0;
    let missed = 0;
    for (let k = d - ADHERENCE_LOOKBACK_DAYS + 1; k <= d; k++) {
      const a = adherenceByDay.get(k);
      if (!a) continue;
      taken += a.taken;
      missed += a.missed;
    }
    // No dose expected in the lookback: adherence is unknown, not low.
    if (taken + missed === 0) return false;
    return taken / (taken + missed) < ADHERENCE_FLOOR;
  };

  const points: { t: number; y: number }[] = [];
  const days = { ...EMPTY_DAYS };
  const sorted = input.dayValues
    .map((v) => ({ d: dayIndex(v.day), day: v.day, value: v.value }))
    .filter((v) => v.d >= from && v.d <= to && Number.isFinite(v.value))
    .sort((a, b) => a.d - b.d);
  let beforeFirst: number | null = null;
  let beforeLast: number | null = null;
  let afterFirst: number | null = null;
  let afterLast: number | null = null;
  for (const v of sorted) {
    const t = v.d - pivot;
    if (t >= 0) {
      if (input.notTakingOn(v.day)) {
        days.excludedNotTaking += 1;
        continue;
      }
      if (lowAdherenceOn(v.d)) {
        days.excludedLowAdherence += 1;
        continue;
      }
      days.after += 1;
      afterFirst ??= t;
      afterLast = t;
    } else {
      days.before += 1;
      beforeFirst ??= t;
      beforeLast = t;
    }
    points.push({ t, y: v.value });
  }

  const span = (a: number | null, b: number | null) =>
    a === null || b === null ? 0 : b - a + 1;
  if (
    days.before < SEGMENTED_MIN_DAYS_PER_SIDE ||
    span(beforeFirst, beforeLast) < SEGMENTED_MIN_SPAN_DAYS
  ) {
    return absent("insufficient_before", window, days, confounders);
  }
  if (
    days.after < SEGMENTED_MIN_DAYS_PER_SIDE ||
    span(afterFirst, afterLast) < SEGMENTED_MIN_SPAN_DAYS
  ) {
    return absent("insufficient_after", window, days, confounders);
  }

  const fit = fitSegmentedRegression(points, { level: SEGMENTED_LEVEL });
  if (!fit) return absent("fit_failed", window, days, confounders);

  return {
    present: true,
    level: SEGMENTED_LEVEL,
    window,
    days,
    adherence,
    levelChange: scaled(fit.levelChange, 1),
    slopeChangePerWeek: scaled(fit.slopeChange, 7),
    preSlopePerWeek: scaled(fit.preSlope, 7),
    fit: {
      n: fit.n,
      df: fit.df,
      rSquared: fit.rSquared,
      residualAutocorrelation: fit.residualAutocorrelation,
      hacLag: fit.hacLag,
    },
    confounders,
  };
}

/** Day keys on which a medication was not being taken (paused, between courses). */
export function notTakingPredicate(
  med: {
    pauseEras: ReadonlyArray<{ pausedAt: Date; resumedAt: Date | null }>;
    courses: ReadonlyArray<{ startsOn: Date; endsOn: Date | null }>;
  },
  timezone: string,
): (day: string) => boolean {
  const pauses = med.pauseEras.map((p) => ({
    from: userDayKey(p.pausedAt, timezone),
    to: p.resumedAt ? userDayKey(p.resumedAt, timezone) : null,
  }));
  const courses = med.courses.map((c) => ({
    from: dayKeyOfDate(c.startsOn),
    to: c.endsOn ? dayKeyOfDate(c.endsOn) : null,
  }));
  return (day: string) => {
    // Paused from the pause day up to (not including) the resume day.
    if (pauses.some((p) => day >= p.from && (p.to === null || day < p.to))) {
      return true;
    }
    if (courses.length === 0) return false;
    return !courses.some(
      (c) => day >= c.from && (c.to === null || day <= c.to),
    );
  };
}
