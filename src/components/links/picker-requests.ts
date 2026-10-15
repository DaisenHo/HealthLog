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
 */
import {
  PICKER_PAGE_SIZE,
  afterPivot,
  type PickerPageRequest,
} from "./use-link-picker-pages";

function withParams(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

/** `GET /api/labs` — offset paging, `from` / `to` on the draw instant. */
export function labPickerUrl(request: PickerPageRequest): string {
  const params = new URLSearchParams({
    limit: String(PICKER_PAGE_SIZE),
    offset: request.cursor ?? "0",
    sortDir: request.direction === "newer" ? "asc" : "desc",
  });
  if (request.direction === "search") params.set("q", request.term);
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
  if (request.direction === "search") params.set("q", request.term);
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
  if (request.direction === "search") params.set("q", request.term);
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
 * The visit route has no text search, so `search` reads the whole history
 * and the picker filters what it has loaded.
 */
export function encounterPickerUrl(request: PickerPageRequest): string {
  const params = new URLSearchParams({
    limit: String(PICKER_PAGE_SIZE),
    offset: request.cursor ?? "0",
  });
  if (request.direction !== "search" && request.pivot !== null) {
    if (request.direction === "older") params.set("to", request.pivot);
    else params.set("from", afterPivot(request.pivot));
  }
  return withParams("/api/encounters", params);
}
