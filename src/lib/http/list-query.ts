/**
 * One way to read a page of a list, and one way to say whether it was cut.
 *
 * The list routes had grown five answers to "is there more": `meta.truncated`
 * from `src/lib/api/list-cap.ts`, a `hasMore` computed as `rows.length ===
 * limit` (true on a list that is exactly full, so a client asks for a page
 * that does not exist), a `total` from a second count query, a sync cursor,
 * and nothing at all. This module is where a capped or paged list gets its
 * page, so the signal is computed the same way everywhere:
 *
 *   - {@link parseListQuery} reads `limit` (and `offset`, where the route
 *     pages) with the route's own default and ceiling;
 *   - {@link listPage} runs the read for one row past the limit and cuts it
 *     back, so `cap.truncated` is exact: true only when a row past the page
 *     exists.
 *
 * The cap is the one in `list-cap.ts` — this module adds no second signal.
 * A route answers with `apiListSuccess(data, cap)` (the envelope's `meta`),
 * or, where a route already published a `hasMore` in its body, derives that
 * field from `cap.truncated`.
 *
 * Every read through here must have a total order: the `orderBy` ends in the
 * row id, so a page boundary between two rows that share a timestamp does not
 * repeat one of them on the next page or drop it. `list-page-guard.test.ts`
 * holds every capped list to this module and to that tiebreaker.
 */
import { z } from "zod";

import { capRows, overfetch, type ListCap } from "@/lib/api/list-cap";

import { listLimitField, listOffsetField } from "./list-query-fields";

export interface ListQueryOptions {
  /** The limit when the request names none. */
  defaultLimit: number;
  /** The largest limit a request may ask for. */
  maxLimit: number;
  /** Whether the route pages with `offset`. */
  offset?: boolean;
}

/**
 * Read `limit` (and `offset`) from a request's query string.
 *
 * Returns the Zod result, so the route answers a bad value with the same
 * multi-issue 422 it gives every other field.
 */
export function parseListQuery(
  params: URLSearchParams,
  options: ListQueryOptions,
) {
  const schema = z.object({
    limit: listLimitField(options),
    offset: options.offset ? listOffsetField() : z.literal(0).default(0),
  });
  return schema.safeParse({
    limit: params.get("limit") ?? undefined,
    offset: options.offset ? (params.get("offset") ?? undefined) : undefined,
  });
}

/**
 * Run a list read for one page and say whether rows past it exist.
 *
 * `read` receives the `take` to pass to Prisma (one past `limit`); the rows
 * come back cut to `limit` with the exact cap beside them.
 */
export async function listPage<T>(
  limit: number,
  read: (take: number) => Promise<readonly T[]>,
): Promise<{ rows: T[]; cap: ListCap }> {
  return capRows(await read(overfetch(limit)), limit);
}

/**
 * The cap of a response that carries several capped lists at once (the
 * encounters' upcoming and past arms, the grants given and received): more
 * rows exist when any one of them was cut.
 */
export function combinedCap(...caps: ListCap[]): ListCap {
  return {
    truncated: caps.some((cap) => cap.truncated),
    limit: Math.max(...caps.map((cap) => cap.limit)),
  };
}
