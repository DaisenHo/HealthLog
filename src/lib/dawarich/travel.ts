/**
 * Travel days: re-judging them when the home country changes, and offering
 * runs of them as trips for the environment module.
 *
 * A suggestion is a run of consecutive travel days in one country that no
 * stored trip (`EnvironmentTravelLocation`) overlaps. Its id is derived from
 * its dates and country, so it is stable across reads and a dismissal sticks
 * until the run itself changes (one more day of travel is a new suggestion).
 * Accepting goes through `POST /api/environment/travel`, where the person
 * picks the place; the trip then covers the run and the suggestion is gone.
 */
import { prisma } from "@/lib/db";
import { shiftDateKey } from "@/lib/tz/format";

import { openDayCountry } from "./connection";
import { travelDay } from "./day-values";

export interface TravelSuggestion {
  id: string;
  startDate: string;
  endDate: string;
  countryCode: string;
}

/** Suggestions reach back this far; an older trip is history, not a prompt. */
const SUGGESTION_WINDOW_DAYS = 365;

/** A run needs at least this many days to be worth a trip. */
const MIN_RUN_DAYS = 2;

export function suggestionId(
  startDate: string,
  endDate: string,
  countryCode: string,
): string {
  return `${startDate}_${endDate}_${countryCode}`;
}

/**
 * Group travel days into runs: consecutive dates in the same country. Pure;
 * input order does not matter.
 */
export function travelRuns(
  days: ReadonlyArray<{ date: string; countryCode: string }>,
): TravelSuggestion[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const runs: TravelSuggestion[] = [];
  let current: { start: string; end: string; code: string } | null = null;
  for (const day of sorted) {
    if (
      current &&
      day.countryCode === current.code &&
      day.date === shiftDateKey(current.end, 1)
    ) {
      current.end = day.date;
      continue;
    }
    if (current) runs.push(toSuggestion(current));
    current = { start: day.date, end: day.date, code: day.countryCode };
  }
  if (current) runs.push(toSuggestion(current));
  return runs;
}

function toSuggestion(run: {
  start: string;
  end: string;
  code: string;
}): TravelSuggestion {
  return {
    id: suggestionId(run.start, run.end, run.code),
    startDate: run.start,
    endDate: run.end,
    countryCode: run.code,
  };
}

/**
 * The open suggestions: runs of at least two travel days in the last year
 * that no stored trip overlaps and the person has not dismissed. Newest first.
 */
export async function listTravelSuggestions(
  userId: string,
  today: string,
  dismissed: ReadonlySet<string>,
): Promise<TravelSuggestion[]> {
  const from = shiftDateKey(today, -SUGGESTION_WINDOW_DAYS);
  const [rows, trips] = await Promise.all([
    prisma.dawarichDay.findMany({
      where: { userId, isTravelDay: true, date: { gte: from } },
      select: { date: true, countryCodeEncrypted: true },
      orderBy: { date: "asc" },
    }),
    prisma.environmentTravelLocation.findMany({
      where: { userId, endDate: { gte: from } },
      select: { startDate: true, endDate: true },
    }),
  ]);
  const days: Array<{ date: string; countryCode: string }> = [];
  for (const row of rows) {
    const code = openDayCountry(row.countryCodeEncrypted);
    if (code) days.push({ date: row.date, countryCode: code });
  }
  return travelRuns(days)
    .filter(
      (run) =>
        daysIn(run) >= MIN_RUN_DAYS &&
        !dismissed.has(run.id) &&
        !trips.some(
          (trip) =>
            trip.startDate <= run.endDate && trip.endDate >= run.startDate,
        ),
    )
    .reverse();
}

function daysIn(run: TravelSuggestion): number {
  let n = 1;
  for (let d = run.startDate; d < run.endDate; d = shiftDateKey(d, 1)) n++;
  return n;
}

/**
 * Re-judge every stored day against a new home country. Days without a
 * country stay null; the rest flip in two statements.
 */
export async function rejudgeTravelDays(
  userId: string,
  homeCountry: string | null,
): Promise<void> {
  const rows = await prisma.dawarichDay.findMany({
    where: { userId, countryCodeEncrypted: { not: null } },
    select: { id: true, countryCodeEncrypted: true },
  });
  const travel: string[] = [];
  const home: string[] = [];
  const unknown: string[] = [];
  for (const row of rows) {
    const verdict = travelDay(
      openDayCountry(row.countryCodeEncrypted),
      homeCountry,
    );
    if (verdict === true) travel.push(row.id);
    else if (verdict === false) home.push(row.id);
    else unknown.push(row.id);
  }
  await prisma.$transaction([
    prisma.dawarichDay.updateMany({
      where: { userId, id: { in: travel } },
      data: { isTravelDay: true },
    }),
    prisma.dawarichDay.updateMany({
      where: { userId, id: { in: home } },
      data: { isTravelDay: false },
    }),
    prisma.dawarichDay.updateMany({
      where: { userId, id: { in: unknown } },
      data: { isTravelDay: null },
    }),
  ]);
}
