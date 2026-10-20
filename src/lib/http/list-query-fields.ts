/**
 * The `limit` and `offset` query fields of a paged list, safe for any bundle.
 *
 * Kept apart from `./list-query.ts` (which reaches the response envelope) so a
 * request schema in `src/lib/validations/` can use them without pulling server
 * code into a client that imports the same schema.
 */
import { z } from "zod";

/** The `limit` field, for a route whose query schema has other fields too. */
export function listLimitField({
  defaultLimit,
  maxLimit,
}: {
  defaultLimit: number;
  maxLimit: number;
}) {
  return z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit);
}

/** The `offset` field, for a route whose query schema has other fields too. */
export function listOffsetField() {
  return z.coerce.number().int().min(0).max(100_000).default(0);
}
