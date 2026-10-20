/**
 * Shared Prisma error narrowing helpers.
 *
 * The P2002 (unique-constraint violation) predicate was hand-copied into
 * five call sites (rollup persist, intake-slot dedup, slot upsert, legacy
 * step consolidation, dense-intraday retention). v1.11.2 folds them into
 * this single helper so a future change to the P2002 semantics has one
 * place to live instead of five.
 *
 * Deliberately structural (`typeof === "object"` + `"code" in err` +
 * `code === "P2002"`) rather than `instanceof Prisma.PrismaClientKnownRequestError`
 * so it survives client-bundling quirks while staying specific to the
 * unique-constraint code.
 */

import { classifyRestoreFailure } from "@/lib/export/restore-failure-cause";

/** Narrow a thrown Prisma error to a specific known-request code. */
function hasPrismaCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === code
  );
}

/** Narrow a thrown Prisma error to the P2002 unique-constraint code. */
export function isP2002(err: unknown): boolean {
  return hasPrismaCode(err, "P2002");
}

/**
 * Narrow a thrown Prisma error to the P2025 "record not found" code — the
 * error `delete` / `update` raise when the target row no longer exists. Lets
 * an idempotent delete treat "already gone" as success while still surfacing a
 * genuine failure (a real DB fault raises a different code and rethrows).
 */
export function isP2025(err: unknown): boolean {
  return hasPrismaCode(err, "P2025");
}

/**
 * Prisma's own codes for a query it refused because of the value it was given:
 * a value too long for its column (P2000), an invalid value or type for a
 * field (P2006, P2007, P2023), and a query that failed validation (P2009,
 * P2012, P2019, P2020).
 */
const PRISMA_INPUT_CODES = new Set([
  "P2000",
  "P2006",
  "P2007",
  "P2009",
  "P2012",
  "P2019",
  "P2020",
  "P2023",
]);

/**
 * Whether a query failed because of the value it was asked about, rather than
 * because of the store it asked. Deliberately a short allowlist: Postgres'
 * data-exception class (SQLSTATE 22, an encoding or a cast it will not accept)
 * and Prisma's validation refusals. Everything else, including failures with
 * no recognisable code at all, is not an answer about the input.
 *
 * The allowlist runs this way round because the other direction cannot be
 * closed: the pool's own "timeout exceeded when trying to connect" carries no
 * code, nor do half the ways a connection ends, and a resource SQLSTATE
 * (53300 too many connections, 53200 out of memory, 55P03 a lock timeout) says
 * nothing about the value either. A denylist of "the database is down" signals
 * folded each of those into "this value matches nothing".
 */
export function isInputRefusal(err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "PrismaClientValidationError"
  ) {
    return true;
  }
  const { code } = classifyRestoreFailure(err);
  if (code === null) return false;
  if (PRISMA_INPUT_CODES.has(code)) return true;
  return /^22[0-9A-Z]{3}$/.test(code);
}
