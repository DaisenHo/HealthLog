/**
 * The list-route requests behind each link picker, one builder per family.
 *
 * Pure, so a test can parse every URL a picker can send against the route's
 * own query schema: a page size or a parameter the route refuses answers 422,
 * and a picker that reads a 422 as an empty list hides the record it exists to
 * offer. That is exactly how a vault once read as empty.
 *
 * Every builder speaks one {@link PickerPageRequest}: `older` is the window up
 * to the split newest first, `newer` the window after it oldest first,
 * `search` the term across the whole history. The cursor is the family's own:
 * an offset for the routes that page by offset, the last row's id for the
 * document route's keyset.
 *
 * A search term that names a year or a month ("2019", "03.2019", "März 2019",
 * see {@link parsePeriodQuery}) is not sent as `q`: it becomes the route's
 * own `from` / `to` window over that period, newest first, so the answer is
 * every record dated in it rather than the records whose name contains the
 * digits. The visit route, which has no text search at all, gets the same
 * window.
 *
 * The period is a calendar period as the person reads it. The routes over an
 * instant (lab draw, condition onset, visit) get the first instant of the
 * period's first day and the last instant of its last day in the person's
 * timezone, the zone every date in the picker is rendered in, so a visit at
 * 00:30 on 1 March is in March for the person who sees it dated 1 March. A
 * date-only lab reading is stored at noon UTC, which reads as its own date in
 * every zone from UTC-11 to UTC+11. The document route's window is already
 * day-granular and inclusive over a stored calendar date, so it gets the two
 * day keys as they are.
 */
import { startOfLocalDayKey } from "@/lib/tz/local-day";
import { shiftDateKey } from "@/lib/tz/format";

import { parsePeriodQuery, type PeriodQuery } from "./period-query";
import {
  PICKER_PAGE_SIZE,
  afterPivot,
  type PickerPageRequest,
} from "./use-link-picker-pages";

function withParams(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

/** The period a search request names, or null outside a period search. */
export function requestPeriod(request: PickerPageRequest): PeriodQuery | null {
  if (request.direction !== "search") return null;
  return parsePeriodQuery(request.term, request.locale);
}

/**
 * The instant window of a period in `timeZone`: from the first instant of its
 * first day to the last millisecond before the day after its last, both
 * inclusive as the instant routes read them.
 */
export function periodInstants(
  period: PeriodQuery,
  timeZone: string,
): { from: string; to: string } {
  const from = startOfLocalDayKey(period.fromDay, timeZone);
  const next = startOfLocalDayKey(shiftDateKey(period.toDay, 1), timeZone);
  return {
    from: from.toISOString(),
    to: new Date(next.getTime() - 1).toISOString(),
  };
}

/** `q`, or the period's instant window, for a search on an instant route. */
function setInstantSearch(
  params: URLSearchParams,
  request: PickerPageRequest,
): void {
  const period = requestPeriod(request);
  if (period) {
    const window = periodInstants(period, request.timeZone);
    params.set("from", window.from);
    params.set("to", window.to);
  } else {
    params.set("q", request.term);
  }
}

/** `GET /api/labs` — offset paging, `from` / `to` on the draw instant. */
export function labPickerUrl(request: PickerPageRequest): string {
  const params = new URLSearchParams({
    limit: String(PICKER_PAGE_SIZE),
    offset: request.cursor ?? "0",
    sortDir: request.direction === "newer" ? "asc" : "desc",
  });
  if (request.direction === "search") setInstantSearch(params, request);
  else if (request.pivot !== null) {
    if (request.direction === "older") params.set("to", request.pivot);
    else params.set("from", afterPivot(request.pivot));
  }
  return withParams("/api/labs", params);
}

/** `GET /api/illness/episodes` — offset paging, the window on the onset. */
export function episodePickerUrl(request: PickerPageRequest): string {
  const params = new URLSearchParams({
    includeResolved: "true",
    limit: String(PICKER_PAGE_SIZE),
    offset: request.cursor ?? "0",
    sortDir: request.direction === "newer" ? "asc" : "desc",
  });
  if (request.direction === "search") setInstantSearch(params, request);
  else if (request.pivot !== null) {
    if (request.direction === "older") params.set("to", request.pivot);
    else params.set("from", afterPivot(request.pivot));
  }
  return withParams("/api/illness/episodes", params);
}

/**
 * `GET /api/documents/inbound` — keyset paging on the filing date. The route's
 * window is day-granular and inclusive, so the newer window starts the day
 * after the split's day.
 */
export function documentPickerUrl(request: PickerPageRequest): string {
  const params = new URLSearchParams({
    sort: "documentDate",
    order: request.direction === "newer" ? "asc" : "desc",
    limit: String(PICKER_PAGE_SIZE),
  });
  if (request.cursor) params.set("cursor", request.cursor);
  const period = requestPeriod(request);
  if (period) {
    params.set("from", period.fromDay);
    params.set("to", period.toDay);
  } else if (request.direction === "search") params.set("q", request.term);
  else if (request.pivot !== null) {
    if (request.direction === "older") {
      params.set("to", request.pivot.slice(0, 10));
    } else {
      params.set("from", afterPivot(request.pivot).slice(0, 10));
    }
  }
  return withParams("/api/documents/inbound", params);
}

/**
 * `GET /api/encounters` — offset paging inside a window on the visit instant.
 * The route answers in two arms (upcoming soonest first, past newest first),
 * each paged by the same offset; the picker merges and orders them itself.
 * The visit route has no text search, so a plain term never reaches it (the
 * picker filters what it has loaded); a period search reads that period.
 */
export function encounterPickerUrl(request: PickerPageRequest): string {
  const params = new URLSearchParams({
    limit: String(PICKER_PAGE_SIZE),
    offset: request.cursor ?? "0",
  });
  const period = requestPeriod(request);
  if (period) {
    const window = periodInstants(period, request.timeZone);
    params.set("from", window.from);
    params.set("to", window.to);
  } else if (request.direction !== "search" && request.pivot !== null) {
    if (request.direction === "older") params.set("to", request.pivot);
    else params.set("from", afterPivot(request.pivot));
  }
  return withParams("/api/encounters", params);
}
