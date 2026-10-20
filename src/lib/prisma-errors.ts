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
 * Whether a query failed because the database could not be reached, as opposed
 * to refusing what it was asked. The first is worth a retry and is a 503; the
 * second is an answer about the input.
 *
 * Reads the same signals the restore classifier does (`connection` and
 * `timeout`: a connection SQLSTATE, a server shutting down, a statement or
 * idle timeout, Prisma's P1001 / P1002 / P1017 / P2028, a terminated
 * connection), plus the two that only a pooled request meets: P2024, no
 * connection free in the pool within its timeout, and P1008, an operation that
 * timed out.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (hasPrismaCode(err, "P2024") || hasPrismaCode(err, "P1008")) return true;
  const { cause } = classifyRestoreFailure(err);
  if (cause === "connection" || cause === "timeout") return true;
  const message = err instanceof Error ? err.message : "";
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|Can't reach database server|timed out/i.test(
    message,
  );
}
