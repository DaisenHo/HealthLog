/**
 * One signal for a list the server cut at a ceiling.
 *
 * A list endpoint that stops at its own `take` and says nothing is the
 * quieter of the two completeness lies: the client renders the last row it
 * got as the oldest one there is. Several routes had grown their own answer
 * (a `truncated` field here, `rows.length === MAX` there, which reports a
 * cut on a list that is exactly full) and most had none.
 *
 * The pattern, in three steps:
 *
 *   1. query one row past the limit: `take: overfetch(limit)`;
 *   2. cut it back: `const { rows, cap } = capRows(found, limit)`;
 *   3. answer with `apiListSuccess(data, cap)`.
 *
 * The signal rides the envelope's `meta` (`meta.truncated`, `meta.limit`), so
 * `data` keeps exactly the shape the route always had and a client that never
 * reads `meta` decodes it unchanged. `truncated` is exact: true only when a
 * row past the limit exists. The OpenAPI side is `listEnvelope` in
 * `src/lib/openapi/routes/shared.ts`. A client reads it through `apiGetList`
 * (`src/lib/api/api-fetch.ts`) and shows it with
 * `ListCapNotice`; `src/__tests__/list-cap-reader-guard.test.ts` binds every
 * capped route to such a reader.
 */
import { apiSuccessWithMeta } from "@/lib/api-response";

import type { ListCap } from "./list-cap-shape";

export type { ListCap } from "./list-cap-shape";

/** The `take` that lets {@link capRows} tell a full list from a cut one. */
export function overfetch(limit: number): number {
  return limit + 1;
}

/** Cut an over-fetched result back to `limit` and say whether it was cut. */
export function capRows<T>(
  found: readonly T[],
  limit: number,
): { rows: T[]; cap: ListCap } {
  const truncated = found.length > limit;
  return {
    rows: truncated ? found.slice(0, limit) : [...found],
    cap: { truncated, limit },
  };
}

/** The success envelope for a capped list: `data` as-is, the cap in `meta`. */
export function apiListSuccess<T>(data: T, cap: ListCap, status = 200) {
  return apiSuccessWithMeta(
    data,
    { truncated: cap.truncated, limit: cap.limit },
    status,
  );
}
