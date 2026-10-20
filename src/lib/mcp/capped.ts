/**
 * A capped MCP read, and the fields that tell the model it was cut.
 *
 * Several tools stopped at their own ceiling and said nothing: the ECG list at
 * 200, the visit history at 50, the booked appointments at 25, the record
 * search at a per-kind scan. A model handed the 50 newest visits reads the
 * fiftieth as the oldest there is and answers "your first cardiology visit was
 * in 2024" from a list that simply ended there.
 *
 * Same semantics as the REST list cap (`src/lib/api/list-cap.ts`), through the
 * same helper: the read asks for one row past the limit, and `truncated` is
 * true only when that row exists. A tool spreads {@link capFields} into its
 * result and {@link cappedOutput} into its output shape.
 */
import { z } from "zod/v4";

import { listPage } from "@/lib/http/list-query";
import type { ListCap } from "@/lib/api/list-cap-shape";

/** Run a capped read: the rows within `limit`, and whether more exist. */
export function capped<T>(
  limit: number,
  read: (take: number) => Promise<readonly T[]>,
): Promise<{ rows: T[]; cap: ListCap }> {
  return listPage(limit, read);
}

/** The cap as tool-result fields. */
export function capFields(cap: ListCap): { truncated: boolean; limit: number } {
  return { truncated: cap.truncated, limit: cap.limit };
}

/**
 * The output-shape fields for a capped list. Optional, because a grounded
 * `{ present: false }` miss carries no list to have cut.
 */
export const cappedOutput = {
  truncated: z
    .boolean()
    .optional()
    .describe(
      "True when more records exist than this result lists: the list was cut at `limit`. Do not treat the last record listed as the oldest or the only one; say the list is partial.",
    ),
  limit: z
    .number()
    .int()
    .optional()
    .describe("The most records this result could list."),
};
