/**
 * v1.4.18 — expansion metrics + earnability flags for the achievement
 * route. Pure helpers operating over typed prisma rows so the unit
 * tests can drive synthetic data without standing up a database.
 *
 * The route stitches these into the existing `metrics` object so
 * `evaluateAchievementsWithCompletionDates` evaluates the new
 * achievements with no further plumbing.
 */
import { calculateLongestStreak, type EarnabilityFlags } from "./achievements";
import { DEFAULT_TIMEZONE, userDayKey } from "@/lib/tz/format";
import { wallClockInTz } from "@/lib/tz/wall-clock";

/**
 * v1.30 (DATAINT M4) — day-key / hour derivation now takes the CALLER's
 * timezone (`User.timezone`), defaulting to `DEFAULT_TIMEZONE` ("Europe/
 * Berlin") when omitted so every existing fixture/caller that never set a
 * `tz` keeps its prior (Berlin-anchored) behaviour byte-for-byte. Before
 * this, every derivation hardcoded Berlin regardless of the achievement
 * owner's real timezone — a non-CET user's evening entries could fold
 * into the wrong calendar day (or merge two real days into one), silently
 * breaking day-streak badges (`entryDayStreak`, `weekendStreakCount`) and
 * the hidden night-owl / early-bird triggers for every non-CET account.
 */
function hourInTz(date: Date, tz: string): number {
  return wallClockInTz(date, tz).hour;
}

function isSaturdayInTz(date: Date, tz: string): boolean {
  return wallClockInTz(date, tz).weekday === 6;
}

export interface MoodEntryRecord {
  date: string; // YYYY-MM-DD (already Berlin-local in MoodEntry schema)
  score: number; // 1..5
  moodLoggedAt: Date;
}

export interface MeasurementRecord {
  type: string;
  measuredAt: Date;
  /**
   * v1.28.25 — row multiplicity. The achievements builder now reads vitals
   * as SQL (day, hour, type) buckets instead of one row per sample (a
   * per-sample PULSE history runs to six figures), so one record here can
   * stand for N underlying rows. Every count-semantics consumer
   * (`countMeasurementsByType`, the hidden-metrics tallies) weighs the
   * record by `count`; day-presence consumers dedup by day key and are
   * multiplicity-blind. Absent means 1 — raw per-sample callers and the
   * existing tests are unchanged.
   */
  count?: number;
}

export interface IntakeEventRecord {
  scheduledFor: Date;
  takenAt: Date | null;
  skipped: boolean;
}

export interface AuditLogRecord {
  action: string;
  createdAt: Date;
}

/**
 * Counts of measurements per type. Used both for the count-based
 * vitals achievements (weight-200 et al.) and for the discovery
 * filter (a user with zero BP measurements never sees the BP
 * progress cards).
 */
export interface MeasurementCounts {
  weightCount: number;
  bpCount: number; // counts BLOOD_PRESSURE_SYS as the canonical BP entry
  pulseCount: number;
}

export function countMeasurementsByType(
  measurements: MeasurementRecord[],
): MeasurementCounts {
  let weight = 0;
  let bp = 0;
  let pulse = 0;
  for (const m of measurements) {
    const n = m.count ?? 1;
    if (m.type === "WEIGHT") weight += n;
    else if (m.type === "BLOOD_PRESSURE_SYS") bp += n;
    else if (m.type === "PULSE") pulse += n;
  }
  return { weightCount: weight, bpCount: bp, pulseCount: pulse };
}

/**
 * Mood metrics. The longest day-streak is computed off the unique
 * Berlin-local `date` strings already stored on `MoodEntry`. The
 * "improvement hit" is a one-shot boolean: did *any* contiguous run
 * of 7 logged days have a mean score at least 1.0 higher than the
 * preceding 7 logged days? The window slides over distinct logged
 * days, not calendar days — so a user who logs daily picks up the
 * achievement on a true 7d-vs-7d comparison; a user with sparse
 * logging compares the 7 most-recent logs against the 7 before that
 * regardless of calendar gap. We intentionally use the user's own
 * baseline (no global comparison) so the badge is non-coercive.
 */
export function getMoodMetrics(entries: MoodEntryRecord[]): {
  moodEntryCount: number;
  moodDayStreak: number;
  moodImprovementHit: number;
} {
  const moodEntryCount = entries.length;
  if (moodEntryCount === 0) {
    return { moodEntryCount: 0, moodDayStreak: 0, moodImprovementHit: 0 };
  }

  const dayKeys = Array.from(new Set(entries.map((e) => e.date))).sort();
  const moodDayStreak = calculateLongestStreak(dayKeys);

  // Aggregate mean score per Berlin day for the improvement check.
  const perDay = new Map<string, { sum: number; count: number }>();
  for (const e of entries) {
    const bucket = perDay.get(e.date) ?? { sum: 0, count: 0 };
    bucket.sum += e.score;
    bucket.count += 1;
    perDay.set(e.date, bucket);
  }
  const sortedDays = Array.from(perDay.entries())
    .map(([date, b]) => ({ date, mean: b.sum / b.count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let moodImprovementHit = 0;
  // Sliding 7-day window mean compared to the preceding 7-day mean.
  // 14 distinct days minimum needed for the comparison to fire.
  for (let i = 13; i < sortedDays.length; i++) {
    const recent = sortedDays.slice(i - 6, i + 1);
    const prior = sortedDays.slice(i - 13, i - 6);
    if (recent.length < 7 || prior.length < 7) continue;
    const recentMean =
      recent.reduce((acc, d) => acc + d.mean, 0) / recent.length;
    const priorMean = prior.reduce((acc, d) => acc + d.mean, 0) / prior.length;
    if (recentMean - priorMean >= 1.0) {
      moodImprovementHit = 1;
      break;
    }
  }

  return { moodEntryCount, moodDayStreak, moodImprovementHit };
}

/**
 * "Consistent month" + entry-streak metrics. Operates on the union of
 * any data point that signals tracking activity — measurements, mood
 * entries, taken/skipped intake events. A day "counts" if it has at
 * least one entry of any kind (Berlin-local).
 */
export function getEngagementMetrics(input: {
  measurements: MeasurementRecord[];
  moodEntries: MoodEntryRecord[];
  intakeEvents: IntakeEventRecord[];
  /**
   * v1.18.11 — day-keys for `measurements`, precomputed once by
   * the caller and passed in parallel to the array. When present the
   * measurement rows reuse these instead of re-deriving a day key per row;
   * mood / intake timestamps (far fewer) still derive inline. Falls back to
   * per-row derivation when absent — byte-identical result either way.
   */
  measurementDayKeys?: string[];
  /** v1.30 (DATAINT M4) — day-key timezone; defaults to Berlin (see file docblock). */
  tz?: string;
}): {
  consistentMonthCount: number;
  entryDayStreak: number;
  weekendStreakCount: number;
} {
  const tz = input.tz ?? DEFAULT_TIMEZONE;
  const dayKeyAccum: string[] = [];
  for (let i = 0; i < input.measurements.length; i++) {
    dayKeyAccum.push(
      input.measurementDayKeys?.[i] ??
        userDayKey(input.measurements[i].measuredAt, tz),
    );
  }
  for (const e of input.moodEntries)
    dayKeyAccum.push(userDayKey(e.moodLoggedAt, tz));
  for (const i of input.intakeEvents) {
    if (i.takenAt) dayKeyAccum.push(userDayKey(i.takenAt, tz));
    else if (i.skipped) dayKeyAccum.push(userDayKey(i.scheduledFor, tz));
  }

  if (dayKeyAccum.length === 0) {
    return {
      consistentMonthCount: 0,
      entryDayStreak: 0,
      weekendStreakCount: 0,
    };
  }

  const uniqueDays = Array.from(new Set(dayKeyAccum)).sort();
  const entryDayStreak = calculateLongestStreak(uniqueDays);

  // consistent-month: did any Berlin-local calendar month have ≥25
  // distinct active days? Effectively boolean — the only achievement
  // this metric backs unlocks at target 1, so once a user hits one
  // consistent month the count stops growing. Caps the wire-payload
  // and avoids unbounded recomputation cost on long-tenured users.
  const monthBuckets = new Map<string, Set<string>>();
  for (const day of uniqueDays) {
    const month = day.slice(0, 7); // YYYY-MM
    const set = monthBuckets.get(month) ?? new Set<string>();
    set.add(day);
    monthBuckets.set(month, set);
  }
  let consistentMonthCount = 0;
  for (const days of monthBuckets.values()) {
    if (days.size >= 25) {
      consistentMonthCount = 1;
      break;
    }
  }

  // weekend-warrior: count of consecutive (Saturday + Sunday) pairs
  // both with at least one entry. We walk the unique day list and
  // count Sat-Sun pairs, then find the longest run of consecutive
  // weekends with both days active. The threshold is currently 4
  // (defined by the achievement); we expose the *count of consecutive
  // weekend pairs in the longest streak* so the UI can also show
  // progress.
  const daySet = new Set(uniqueDays);
  // Build the list of weekend-pair "yes/no" markers ordered by date.
  // Iterate over every Saturday in the date range from the first
  // active day to the last.
  const firstDay = uniqueDays[0];
  const lastDay = uniqueDays[uniqueDays.length - 1];
  let weekendStreakCount = 0;
  let weekendRun = 0;
  // Walk one Saturday at a time. Use a simple `Date` cursor; the
  // caller's tz formatter resolves the weekday so DST shifts are safe.
  const cursor = parseDayKey(firstDay);
  const end = parseDayKey(lastDay);
  // Snap cursor to the next Saturday at 12:00 UTC (avoids DST edges).
  cursor.setUTCHours(12, 0, 0, 0);
  while (!isSaturdayInTz(cursor, tz)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor > end) break;
  }
  while (cursor <= end) {
    const sat = userDayKey(cursor, tz);
    const sunDate = new Date(cursor);
    sunDate.setUTCDate(sunDate.getUTCDate() + 1);
    const sun = userDayKey(sunDate, tz);
    if (daySet.has(sat) && daySet.has(sun)) {
      weekendRun += 1;
      weekendStreakCount = Math.max(weekendStreakCount, weekendRun);
    } else {
      weekendRun = 0;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return { consistentMonthCount, entryDayStreak, weekendStreakCount };
}

function parseDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Hidden Easter-egg metrics. Each metric is a *count* (not a streak)
 * so the achievement target = 1 fires the first time the trigger is
 * met. Triggers never reveal themselves to the user — locked cards
 * paint the opaque placeholder.
 */
export function getHiddenMetrics(input: {
  measurements: MeasurementRecord[];
  moodEntries: MoodEntryRecord[];
  intakeEvents: IntakeEventRecord[];
  auditEvents: AuditLogRecord[];
  /**
   * v1.18.11 — Berlin day-keys + hours for `measurements`,
   * precomputed once by the caller and passed in parallel to the array. When
   * present the measurement rows reuse these instead of re-running
   * `Intl.DateTimeFormat` per row for both the hour and the day-key; mood /
   * intake timestamps (far fewer) still derive inline. Byte-identical to the
   * per-row derivation either way.
   */
  measurementDayKeys?: string[];
  measurementHours?: number[];
  /** v1.30 (DATAINT M4) — day-key timezone; defaults to Berlin (see file docblock). */
  tz?: string;
}): {
  nightOwlCount: number;
  earlyBirdCount: number;
  leapDayCount: number;
  doctorPdfCount: number;
  localeFlipCount: number;
} {
  const tz = input.tz ?? DEFAULT_TIMEZONE;
  let nightOwl = 0;
  let earlyBird = 0;
  let leapDay = 0;

  // v1.28.25 — `n` is the row multiplicity (`MeasurementRecord.count`): a
  // bucketed vitals record stands for N raw rows, and these are COUNT
  // metrics, so each contributes N. Mood / intake tallies stay per-row (n=1).
  const tally = (hour: number, dayKey: string, n = 1): void => {
    if (hour >= 2 && hour < 4) nightOwl += n;
    if (hour >= 4 && hour < 6) earlyBird += n;
    // Feb 29 — only valid in leap years.
    if (dayKey.endsWith("-02-29")) leapDay += n;
  };

  for (let i = 0; i < input.measurements.length; i++) {
    const m = input.measurements[i];
    tally(
      input.measurementHours?.[i] ?? hourInTz(m.measuredAt, tz),
      input.measurementDayKeys?.[i] ?? userDayKey(m.measuredAt, tz),
      m.count ?? 1,
    );
  }
  for (const e of input.moodEntries) {
    tally(hourInTz(e.moodLoggedAt, tz), userDayKey(e.moodLoggedAt, tz));
  }
  for (const i of input.intakeEvents) {
    if (i.takenAt) tally(hourInTz(i.takenAt, tz), userDayKey(i.takenAt, tz));
  }

  let doctorPdfCount = 0;
  let localeFlipCount = 0;
  for (const ev of input.auditEvents) {
    // Both "generate" + "pdf.generate" count — the PDF route emits the
    // latter; the JSON-only generate route emits the former. We accept
    // either as the trigger so the badge fires the first time the user
    // exercises the doctor-report feature in any shape.
    if (
      ev.action === "doctor-report.generate" ||
      ev.action === "doctor-report.pdf.generate"
    ) {
      doctorPdfCount += 1;
    }
    if (ev.action === "settings.locale.update") localeFlipCount += 1;
  }

  return {
    nightOwlCount: nightOwl,
    earlyBirdCount: earlyBird,
    leapDayCount: leapDay,
    doctorPdfCount,
    localeFlipCount,
  };
}

/**
 * v1.4.18 — earnability flags. A flag is true iff the user has at
 * least one underlying data point for the metric category. The
 * discovery filter consumes this to decide whether a public locked
 * achievement should render.
 */
export function getEarnabilityFlags(input: {
  hasMedication: boolean;
  moodEntryCount: number;
  measurementCounts: MeasurementCounts;
  /** v1.16.1 — sleep samples gate the sleep-logging streak badge. */
  sleepSampleCount?: number;
}): EarnabilityFlags {
  return {
    hasMedication: input.hasMedication,
    hasMood: input.moodEntryCount > 0,
    hasWeight: input.measurementCounts.weightCount > 0,
    hasBp: input.measurementCounts.bpCount > 0,
    hasPulse: input.measurementCounts.pulseCount > 0,
    hasSleep: (input.sleepSampleCount ?? 0) > 0,
  };
}

export type ExpansionMetrics = {
  moodEntryCount: number;
  moodDayStreak: number;
  moodImprovementHit: number;
  weightMeasurementCount: number;
  bpMeasurementCount: number;
  pulseMeasurementCount: number;
  consistentMonthCount: number;
  entryDayStreak: number;
  weekendStreakCount: number;
  nightOwlCount: number;
  earlyBirdCount: number;
  leapDayCount: number;
  doctorPdfCount: number;
  localeFlipCount: number;
};

export function buildExpansionMetricValues(input: {
  measurements: MeasurementRecord[];
  moodEntries: MoodEntryRecord[];
  intakeEvents: IntakeEventRecord[];
  auditEvents: AuditLogRecord[];
  /**
   * v1.18.11 — Berlin day-keys for `measurements`, precomputed once
   * by the caller (the achievements builder already derives them for the
   * green-day / weekly-consistency passes) and threaded into the engagement +
   * hidden passes so the full vitals array is `Intl`-walked once, not ~3×.
   */
  measurementDayKeys?: string[];
  /**
   * v1.28.25 — Berlin hours for `measurements`, precomputed by the caller.
   * The bucketed-vitals path (SQL `(day, hour, type)` buckets) carries the
   * Berlin hour straight from the query; deriving it here from a bucket's
   * representative `measuredAt` would be wrong, so the caller MUST supply
   * this alongside bucketed records. Raw per-row callers omit it and the
   * hours derive from `measuredAt` exactly as before.
   */
  measurementHours?: number[];
  /** v1.30 (DATAINT M4) — day-key timezone; defaults to Berlin (see file docblock). */
  tz?: string;
}): ExpansionMetrics {
  const tz = input.tz ?? DEFAULT_TIMEZONE;
  const counts = countMeasurementsByType(input.measurements);
  const mood = getMoodMetrics(input.moodEntries);
  // The hidden pass also needs the per-row hour; derive it once here (only
  // when the caller supplied day-keys, i.e. on the hot achievements path) so
  // a single hour pass replaces the per-pass re-derivation.
  const measurementHours =
    input.measurementHours ??
    (input.measurementDayKeys
      ? input.measurements.map((m) => hourInTz(m.measuredAt, tz))
      : undefined);
  const engagement = getEngagementMetrics({
    measurements: input.measurements,
    moodEntries: input.moodEntries,
    intakeEvents: input.intakeEvents,
    measurementDayKeys: input.measurementDayKeys,
    tz,
  });
  const hidden = getHiddenMetrics({
    measurements: input.measurements,
    moodEntries: input.moodEntries,
    intakeEvents: input.intakeEvents,
    auditEvents: input.auditEvents,
    measurementDayKeys: input.measurementDayKeys,
    measurementHours,
    tz,
  });

  return {
    moodEntryCount: mood.moodEntryCount,
    moodDayStreak: mood.moodDayStreak,
    moodImprovementHit: mood.moodImprovementHit,
    weightMeasurementCount: counts.weightCount,
    bpMeasurementCount: counts.bpCount,
    pulseMeasurementCount: counts.pulseCount,
    consistentMonthCount: engagement.consistentMonthCount,
    entryDayStreak: engagement.entryDayStreak,
    weekendStreakCount: engagement.weekendStreakCount,
    nightOwlCount: hidden.nightOwlCount,
    earlyBirdCount: hidden.earlyBirdCount,
    leapDayCount: hidden.leapDayCount,
    doctorPdfCount: hidden.doctorPdfCount,
    localeFlipCount: hidden.localeFlipCount,
  };
}
