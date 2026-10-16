/**
 * Fold what Dawarich answered into one row of daily values per local day.
 *
 * Pure: the sync fetches, this decides. Nothing here sees a coordinate or a
 * name; the client has already reduced visits to a place id and a span, and
 * the residency to a country code per date.
 *
 *   distances      from the timeline summary, km to whole metres.
 *   places         `places_visited` of the summary.
 *   away from home the day's minutes minus the minutes a visit at the home
 *                  place covers. Without a home place, or without a single
 *                  visit touching the day, there is no coverage and the value
 *                  is null, never zero.
 *   country        the residency country of the date. Dawarich keys residency
 *                  by UTC date, so on a day that crosses a border late in the
 *                  evening the country may be the next morning's; the travel
 *                  run is days long, one edge day does not change it.
 *   travel day     the country differs from the home country; null without
 *                  either.
 */
import { localDayWindow } from "@/lib/tz/local-day";

import type { DailyCountries, TimelineDaySummary, VisitSpan } from "./client";

export interface DawarichDayValues {
  date: string;
  totalDistanceM: number | null;
  drivingDistanceM: number | null;
  trainDistanceM: number | null;
  placesVisited: number | null;
  awayFromHomeMinutes: number | null;
  countryCode: string | null;
  isTravelDay: boolean | null;
}

const MINUTE_MS = 60_000;

function kmToMetres(km: number | null): number | null {
  return km === null ? null : Math.round(km * 1000);
}

/**
 * Minutes of `[dayStart, dayEnd)` not covered by a visit at `homePlaceId`.
 * Null when no home place is set or no visit at all touches the day.
 */
export function awayFromHomeMinutes(
  visits: readonly VisitSpan[],
  dayStart: Date,
  dayEnd: Date,
  homePlaceId: number | null,
): number | null {
  if (homePlaceId === null) return null;
  const start = dayStart.getTime();
  const end = dayEnd.getTime();
  const touching = visits.filter((v) => v.startMs < end && v.endMs > start);
  if (touching.length === 0) return null;
  const home = touching
    .filter((v) => v.placeId === homePlaceId)
    .map((v) => [Math.max(v.startMs, start), Math.min(v.endMs, end)] as const)
    .sort((a, b) => a[0] - b[0]);
  // Merge overlapping home spans so a visit Dawarich split in two is not
  // counted twice.
  let covered = 0;
  let runStart: number | null = null;
  let runEnd = 0;
  for (const [s, e] of home) {
    if (runStart === null || s > runEnd) {
      if (runStart !== null) covered += runEnd - runStart;
      runStart = s;
      runEnd = e;
    } else if (e > runEnd) {
      runEnd = e;
    }
  }
  if (runStart !== null) covered += runEnd - runStart;
  return Math.max(0, Math.round((end - start - covered) / MINUTE_MS));
}

/**
 * The most frequent country over the given dates, or null when none has one.
 * Ties go to the alphabetically first code, so the answer does not depend on
 * the order Dawarich listed the days in.
 */
export function mostFrequentCountry(
  countries: DailyCountries,
  fromDate: string,
  toDate: string,
): string | null {
  const counts = new Map<string, number>();
  for (const [date, code] of countries) {
    if (date < fromDate || date > toDate) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of [...counts].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/**
 * One row per day that Dawarich holds anything for. A day with no summary, no
 * visit and no country is left out: there is nothing to say about it, and an
 * empty row would read as "measured, nothing happened".
 */
export function buildDayValues(input: {
  days: readonly string[];
  tz: string;
  timeline: readonly TimelineDaySummary[];
  visits: readonly VisitSpan[];
  countries: DailyCountries | null;
  homePlaceId: number | null;
  homeCountry: string | null;
}): DawarichDayValues[] {
  const summaryByDate = new Map(input.timeline.map((d) => [d.date, d]));
  const out: DawarichDayValues[] = [];
  for (const date of input.days) {
    const summary = summaryByDate.get(date) ?? null;
    const { dayStart, dayEnd } = localDayWindow(date, input.tz);
    const away = awayFromHomeMinutes(
      input.visits,
      dayStart,
      dayEnd,
      input.homePlaceId,
    );
    const touched = input.visits.some(
      (v) => v.startMs < dayEnd.getTime() && v.endMs > dayStart.getTime(),
    );
    const countryCode = input.countries?.get(date) ?? null;
    if (!summary && !touched && !countryCode) continue;
    out.push({
      date,
      totalDistanceM: kmToMetres(summary?.totalKm ?? null),
      drivingDistanceM: kmToMetres(summary?.drivingKm ?? null),
      trainDistanceM: kmToMetres(summary?.trainKm ?? null),
      placesVisited: summary?.placesVisited ?? null,
      awayFromHomeMinutes: away,
      countryCode,
      isTravelDay: travelDay(countryCode, input.homeCountry),
    });
  }
  return out;
}

/** A travel day needs both a country and a home country to compare with. */
export function travelDay(
  countryCode: string | null,
  homeCountry: string | null,
): boolean | null {
  if (!countryCode || !homeCountry) return null;
  return countryCode !== homeCountry;
}
