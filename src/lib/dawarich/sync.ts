/**
 * Fetch a range of days from Dawarich and store their daily values.
 *
 * Per run: one timeline request per 30 days, one visits request for the whole
 * range (reaching a week back, so a stay at home that began before the range
 * still counts), and one residency request per calendar year the range or the
 * home-country window touches. Each stored day is an upsert on
 * `(user_id, date)`, so a run over days already stored refreshes them.
 *
 * The outcome lands on the shared integration ledger (`dawarich`): a clean run
 * records a success, a failed request a classified failure. The connection
 * health and the watchdog read that ledger like every other connection.
 */
import { prisma } from "@/lib/db";
import {
  markSyncFailureRecorded,
  recordSyncFailure,
  recordSyncSuccess,
  type FailureKind,
} from "@/lib/integrations/status";
import { localDayWindow } from "@/lib/tz/local-day";
import { shiftDateKey, userDayKey } from "@/lib/tz/format";
import { resolveUserTimezone } from "@/lib/tz/resolver";

import {
  DawarichApiError,
  DawarichPolicyError,
  fetchResidency,
  fetchTimeline,
  fetchVisits,
  TIMELINE_MAX_DAYS,
  type DailyCountries,
  type TimelineDaySummary,
} from "./client";
import {
  effectiveHomeCountry,
  loadDawarichConnection,
  saveDawarichPrefs,
  sealDayCountry,
} from "./connection";
import { buildDayValues, mostFrequentCountry } from "./day-values";

/** The window the home country is derived from. */
const HOME_COUNTRY_WINDOW_DAYS = 365;

/** How far before the range the visits request reaches. */
const VISIT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Days per timeline request, inside Dawarich's 31-day limit. */
const TIMELINE_CHUNK_DAYS = TIMELINE_MAX_DAYS - 1;

export interface DawarichSyncResult {
  /** Days written this run (new or refreshed). */
  daysStored: number;
  /** Nothing ran: there is no stored connection. */
  notConnected: boolean;
}

/** Map a failed request onto the ledger's failure kind. */
export function classifyDawarichFailure(error: unknown): FailureKind {
  if (error instanceof DawarichPolicyError) return "persistent";
  if (error instanceof DawarichApiError && error.status !== null) {
    if (error.status === 401 || error.status === 403) return "reauth_required";
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      return "persistent";
    }
  }
  // 5xx, 429, timeouts and unreachable hosts: try again next run.
  return "transient";
}

/** The short code a failure is recorded with; never a message or a URL. */
export function dawarichFailureCode(error: unknown): string {
  if (error instanceof DawarichPolicyError) return error.reasonCode;
  if (error instanceof DawarichApiError) {
    return error.status === null ? "invalid_body" : String(error.status);
  }
  return "unreachable";
}

async function recordFailure(userId: string, error: unknown): Promise<void> {
  const code = dawarichFailureCode(error);
  await recordSyncFailure({
    userId,
    integration: "dawarich",
    kind: classifyDawarichFailure(error),
    // The code alone: an upstream message can carry the instance address, and
    // the address is the person's own network.
    message: `dawarich ${code}`,
    errorCode: code,
  });
}

function daysOf(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  for (let d = fromDate; d <= toDate; d = shiftDateKey(d, 1)) out.push(d);
  return out;
}

function yearsOf(...ranges: Array<[string, string]>): number[] {
  const years = new Set<number>();
  for (const [from, to] of ranges) {
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      years.add(y);
    }
  }
  return [...years].sort();
}

/** Yesterday in the account's zone: the newest day a run fetches. */
export function yesterdayKey(tz: string, now: Date = new Date()): string {
  return shiftDateKey(userDayKey(now, tz), -1);
}

/**
 * Fetch and store `[fromDate, toDate]` (local day keys, inclusive). Throws on
 * a failed request after recording it on the ledger (marked, so a caller does
 * not record it twice).
 */
export async function syncDawarichRange(
  userId: string,
  fromDate: string,
  toDate: string,
  now: Date = new Date(),
): Promise<DawarichSyncResult> {
  const stored = await loadDawarichConnection(userId);
  if (!stored) return { daysStored: 0, notConnected: true };
  if (fromDate > toDate) return { daysStored: 0, notConnected: false };

  const { connection, prefs } = stored;
  const tz = await resolveUserTimezone(userId);
  const days = daysOf(fromDate, toDate);
  const today = userDayKey(now, tz);
  const homeWindowFrom = shiftDateKey(today, -HOME_COUNTRY_WINDOW_DAYS);

  let timeline: TimelineDaySummary[] = [];
  let visits: Awaited<ReturnType<typeof fetchVisits>> = [];
  let countries: DailyCountries | null = null;
  try {
    for (let i = 0; i < days.length; i += TIMELINE_CHUNK_DAYS) {
      const chunk = days.slice(i, i + TIMELINE_CHUNK_DAYS);
      const { dayStart } = localDayWindow(chunk[0], tz);
      const { dayEnd } = localDayWindow(chunk[chunk.length - 1], tz);
      timeline = timeline.concat(
        await fetchTimeline(
          connection,
          dayStart,
          new Date(dayEnd.getTime() - 1000),
        ),
      );
    }
    const rangeStart = localDayWindow(fromDate, tz).dayStart;
    const rangeEnd = localDayWindow(toDate, tz).dayEnd;
    visits = await fetchVisits(
      connection,
      new Date(rangeStart.getTime() - VISIT_LOOKBACK_MS),
      rangeEnd,
    );
    const years = yearsOf(
      [fromDate, toDate],
      ...(prefs.homeCountry === null
        ? [[homeWindowFrom, today] as [string, string]]
        : []),
    );
    for (const year of years) {
      const yearCountries = await fetchResidency(connection, year);
      if (!yearCountries) continue;
      countries ??= new Map();
      for (const [date, code] of yearCountries) countries.set(date, code);
    }
  } catch (error) {
    await recordFailure(userId, error);
    throw markSyncFailureRecorded(error);
  }

  // The derived home country follows the residency the instance holds; a run
  // that could not read residency keeps the previous one.
  let nextPrefs = prefs;
  if (countries && prefs.homeCountry === null) {
    const derived = mostFrequentCountry(countries, homeWindowFrom, today);
    if (derived !== prefs.derivedHomeCountry) {
      nextPrefs = { ...prefs, derivedHomeCountry: derived };
      await saveDawarichPrefs(userId, nextPrefs);
    }
  }

  const rows = buildDayValues({
    days,
    tz,
    timeline,
    visits,
    countries,
    homePlaceId: nextPrefs.homePlaceId,
    homeCountry: effectiveHomeCountry(nextPrefs),
  });

  const fetchedAt = new Date();
  await prisma.$transaction(
    rows.map((row) => {
      const data = {
        totalDistanceM: row.totalDistanceM,
        drivingDistanceM: row.drivingDistanceM,
        trainDistanceM: row.trainDistanceM,
        placesVisited: row.placesVisited,
        awayFromHomeMinutes: row.awayFromHomeMinutes,
        countryCodeEncrypted: row.countryCode
          ? sealDayCountry(row.countryCode)
          : null,
        isTravelDay: row.isTravelDay,
        fetchedAt,
      };
      return prisma.dawarichDay.upsert({
        where: { userId_date: { userId, date: row.date } },
        create: { userId, date: row.date, ...data },
        update: data,
      });
    }),
  );

  await recordSyncSuccess(userId, "dawarich");
  return { daysStored: rows.length, notConnected: false };
}
