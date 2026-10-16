/**
 * Dawarich API client: the wire shapes HealthLog reads and nothing more.
 *
 * Dawarich (https://dawarich.app) is a self-hosted location history. HealthLog
 * reads four endpoints, all with `Authorization: Bearer <api key>`:
 *
 *   GET /api/v1/timeline?start_at&end_at&distance_unit=km
 *       one entry per day in the Dawarich account's own zone (its timezone
 *       setting, the instance's `TIME_ZONE` by default; the request cannot
 *       name one), summing only what lies inside the window, with a `summary`:
 *       `total_distance`, `places_visited`, `mode_distances.{driving,train}`
 *       in km to one decimal. At most 31 days per request.
 *   GET /api/v1/visits?start_at&end_at
 *       visits that STARTED in the window: `started_at`, `ended_at`,
 *       `status`, `place.id`. The coordinates and the name in the payload
 *       are read past and dropped here; nothing but the place id survives.
 *   GET /api/v1/residency?year=YYYY
 *       `daily_countries` (UTC date to country name) and `countries[]`
 *       (country name to ISO 3166-1 alpha-2). Answers 403 on a hosted plan
 *       without API access; then there is no travel signal.
 *   GET /api/v1/places, /api/v1/places/:id
 *       to pick and check the home place; id and name only, never stored.
 *   GET /api/v1/users/me
 *       the cheapest authenticated call, used to check a key.
 *
 * Every call goes through `safeFetch`: `requirePublicHost` for a public
 * instance, the operator-approved pinned dispatcher for an origin listed in
 * `DAWARICH_PRIVATE_ORIGINS`. The policy is re-read on every call, so taking
 * an origin off the list stops the next request.
 */
import { readBodyCapped } from "@/lib/http/read-capped";
import { SafeFetchError, safeFetch } from "@/lib/safe-fetch";

import {
  configuredDawarichPrivateOrigins,
  evaluateDawarichUrl,
} from "./origin";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The most any one answer may hold. A month of timeline with its entries and
 * a year of residency stay far below it; the cap is what keeps an instance
 * that streams without end from holding the worker's memory until the
 * timeout.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Dawarich refuses a timeline window longer than 31 days. */
export const TIMELINE_MAX_DAYS = 31;

/** The places list is read once per request and capped before filtering. */
const PLACES_PAGE_SIZE = 500;

/** At most this many places go back to the picker. */
const PLACES_RESULT_LIMIT = 200;

export interface DawarichConnection {
  baseUrl: string;
  apiKey: string;
}

/** The instance answered with a status outside 2xx, or not with JSON. */
export class DawarichApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "DawarichApiError";
    this.status = status;
  }
}

/** The address is private and not on the operator's list, or not usable at all. */
export class DawarichPolicyError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "DawarichPolicyError";
    this.reasonCode = reasonCode;
  }
}

async function dawarichGet(
  conn: DawarichConnection,
  path: string,
  query: Record<string, string> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const target = evaluateDawarichUrl(
    conn.baseUrl,
    configuredDawarichPrivateOrigins(),
  );
  if (!target.allowed || !target.baseUrl || !target.origin) {
    throw new DawarichPolicyError(
      target.reasonCode ?? "private_origin_not_approved",
    );
  }
  const url = new URL(`${target.baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await safeFetch(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${conn.apiKey}`,
        },
      },
      {
        requirePublicHost: !target.privateOriginApproved,
        ...(target.privateOriginApproved
          ? { operatorApprovedPrivateOrigin: target.origin }
          : {}),
        timeoutMs,
      },
    );
  } catch (error) {
    if (error instanceof SafeFetchError && error.kind === "private_host") {
      throw new DawarichPolicyError("private_origin_not_approved");
    }
    throw error;
  }

  if (res.status < 200 || res.status >= 300) {
    throw new DawarichApiError(`Dawarich responded ${res.status}`, res.status);
  }
  const read = await readBodyCapped(res, MAX_BODY_BYTES);
  if (!read.ok) {
    throw new DawarichApiError("Dawarich returned an oversized body", null);
  }
  try {
    return JSON.parse(read.text) as unknown;
  } catch {
    throw new DawarichApiError("Dawarich returned a non-JSON body", null);
  }
}

// ── Timeline ─────────────────────────────────────────────────────────

/** One day's summary, distances in km as Dawarich reports them. */
export interface TimelineDaySummary {
  date: string;
  totalKm: number | null;
  drivingKm: number | null;
  trainKm: number | null;
  placesVisited: number | null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * Read the day summaries out of a timeline answer. A mode absent from
 * `mode_distances` is zero for that day (Dawarich leaves out a mode that moved
 * less than half a kilometre), so it reads as 0 whenever the summary itself is
 * there. Everything else in the payload (entries, bounds, names) is dropped.
 */
export function parseTimelineDays(payload: unknown): TimelineDaySummary[] {
  const days = (payload as { days?: unknown } | null)?.days;
  if (!Array.isArray(days)) return [];
  const out: TimelineDaySummary[] = [];
  for (const raw of days) {
    if (!raw || typeof raw !== "object") continue;
    const day = raw as { date?: unknown; summary?: unknown };
    if (typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
      continue;
    }
    const summary =
      day.summary && typeof day.summary === "object"
        ? (day.summary as Record<string, unknown>)
        : null;
    if (!summary) continue;
    const modes =
      summary.mode_distances && typeof summary.mode_distances === "object"
        ? (summary.mode_distances as Record<string, unknown>)
        : {};
    out.push({
      date: day.date,
      totalKm: finiteOrNull(summary.total_distance),
      drivingKm: finiteOrNull(modes.driving) ?? 0,
      trainKm: finiteOrNull(modes.train) ?? 0,
      placesVisited:
        typeof summary.places_visited === "number" &&
        Number.isInteger(summary.places_visited) &&
        summary.places_visited >= 0
          ? summary.places_visited
          : null,
    });
  }
  return out;
}

export async function fetchTimeline(
  conn: DawarichConnection,
  startAt: Date,
  endAt: Date,
): Promise<TimelineDaySummary[]> {
  return parseTimelineDays(
    await dawarichGet(conn, "/api/v1/timeline", {
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      distance_unit: "km",
    }),
  );
}

// ── Visits ───────────────────────────────────────────────────────────

/** A visit reduced to what time away from home needs. */
export interface VisitSpan {
  placeId: number | null;
  startMs: number;
  endMs: number;
}

/**
 * Read the visits. A declined visit (the person said it did not happen) is
 * dropped; so is one without a usable time span. Coordinates and names in the
 * payload are never copied out.
 */
export function parseVisits(payload: unknown): VisitSpan[] {
  if (!Array.isArray(payload)) return [];
  const out: VisitSpan[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const visit = raw as Record<string, unknown>;
    if (visit.status === "declined") continue;
    const startMs =
      typeof visit.started_at === "string" ? Date.parse(visit.started_at) : NaN;
    const endMs =
      typeof visit.ended_at === "string" ? Date.parse(visit.ended_at) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs <= startMs) continue;
    const place =
      visit.place && typeof visit.place === "object"
        ? (visit.place as Record<string, unknown>)
        : null;
    const placeId =
      typeof place?.id === "number" && Number.isInteger(place.id)
        ? place.id
        : null;
    out.push({ placeId, startMs, endMs });
  }
  return out;
}

export async function fetchVisits(
  conn: DawarichConnection,
  startAt: Date,
  endAt: Date,
): Promise<VisitSpan[]> {
  return parseVisits(
    await dawarichGet(conn, "/api/v1/visits", {
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
    }),
  );
}

// ── Residency ────────────────────────────────────────────────────────

/** UTC date to ISO 3166-1 alpha-2, for the days the year holds a country. */
export type DailyCountries = Map<string, string>;

/**
 * Read `daily_countries` and translate each country name through the
 * `countries[]` table into its alpha-2 code. A name without a code is dropped:
 * a country HealthLog cannot name is no basis for a travel day.
 */
export function parseResidency(payload: unknown): DailyCountries {
  const out: DailyCountries = new Map();
  if (!payload || typeof payload !== "object") return out;
  const body = payload as Record<string, unknown>;
  const codeByName = new Map<string, string>();
  if (Array.isArray(body.countries)) {
    for (const raw of body.countries) {
      if (!raw || typeof raw !== "object") continue;
      const country = raw as Record<string, unknown>;
      if (
        typeof country.country_name === "string" &&
        typeof country.iso_a2 === "string" &&
        /^[A-Za-z]{2}$/.test(country.iso_a2)
      ) {
        codeByName.set(country.country_name, country.iso_a2.toUpperCase());
      }
    }
  }
  const daily =
    body.daily_countries && typeof body.daily_countries === "object"
      ? (body.daily_countries as Record<string, unknown>)
      : {};
  for (const [date, name] of Object.entries(daily)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof name !== "string") continue;
    const code = codeByName.get(name);
    if (code) out.set(date, code);
  }
  return out;
}

/**
 * One year of residency, or null when the instance does not offer it (a
 * hosted plan without API access answers 403, an older instance 404). Any
 * other failure is thrown like every other call.
 */
export async function fetchResidency(
  conn: DawarichConnection,
  year: number,
): Promise<DailyCountries | null> {
  try {
    return parseResidency(
      await dawarichGet(conn, "/api/v1/residency", { year: String(year) }),
    );
  } catch (error) {
    if (
      error instanceof DawarichApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      return null;
    }
    throw error;
  }
}

// ── Places ───────────────────────────────────────────────────────────

export interface DawarichPlace {
  id: number;
  name: string;
}

/** Id and name of each place, filtered by `q`, sorted by name, capped. */
export function parsePlaces(payload: unknown, q?: string): DawarichPlace[] {
  if (!Array.isArray(payload)) return [];
  const needle = q?.trim().toLocaleLowerCase() ?? "";
  const out: DawarichPlace[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const place = raw as Record<string, unknown>;
    if (typeof place.id !== "number" || !Number.isInteger(place.id)) continue;
    const name = typeof place.name === "string" ? place.name.trim() : "";
    if (!name) continue;
    if (needle && !name.toLocaleLowerCase().includes(needle)) continue;
    out.push({ id: place.id, name: name.slice(0, 200) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return out.slice(0, PLACES_RESULT_LIMIT);
}

export async function fetchPlaces(
  conn: DawarichConnection,
  q?: string,
): Promise<DawarichPlace[]> {
  return parsePlaces(
    await dawarichGet(conn, "/api/v1/places", {
      filter: "all",
      page: "1",
      per_page: String(PLACES_PAGE_SIZE),
    }),
    q,
  );
}

/** Whether the instance knows a place with this id. */
export async function placeExists(
  conn: DawarichConnection,
  id: number,
): Promise<boolean> {
  try {
    await dawarichGet(conn, `/api/v1/places/${id}`);
    return true;
  } catch (error) {
    if (error instanceof DawarichApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

/** Check the key with the cheapest authenticated call. */
export async function probeDawarich(
  conn: DawarichConnection,
  timeoutMs?: number,
): Promise<void> {
  await dawarichGet(conn, "/api/v1/users/me", {}, timeoutMs);
}
