/**
 * Per-test helpers for the integration suite. The Postgres testcontainer
 * is started once in global-setup.ts and bridged into each worker by
 * environment-setup.ts before application modules load.
 */
import { inject } from "vitest";

import { prisma } from "@/lib/db";
import { assertRecordContext } from "./mock-next-headers";
import {
  START_EMPTY_TABLES,
  type IntegrationDatabasePlan,
} from "./worker-database";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The application's Prisma singleton. Tests use this so any code
 * imported via `await import("@/lib/...")` shares the exact same client
 * instance — no risk of a divergent connection pool reading stale
 * truncation state.
 */
export function getPrismaClient(): PrismaClient {
  return prisma;
}

/**
 * Return the database to the state a fresh install has: every table in
 * `public` emptied, then the rows the migrations seed put back (the mood-tag,
 * cycle-symptom and illness-symptom catalogues). Call from beforeEach() to
 * make tests independent.
 *
 * Both lists come from the migrated template, read once in
 * `global-setup.ts`: the tables from the catalogue (`pg_tables` minus the
 * migration bookkeeping), the seeded rows from the tables that hold any
 * before a test has run. The list used to be written by hand and covered 42
 * of 166 tables; a table outside it kept whatever the previous file left,
 * which is how a case came to pass or fail depending on file order. Now a new
 * table is covered by existing, and the one exception is declared in
 * `START_EMPTY_TABLES` with its reason.
 *
 * Instance-wide schemas the application creates at runtime (pg-boss) are not
 * touched between tests of one file, because a file may hold a running queue
 * across them; they are dropped when the next file starts in the worker (see
 * `worker-database.ts`).
 */
export async function truncateAllTables(
  client: {
    $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  },
  plan: IntegrationDatabasePlan = inject("integrationDatabasePlan"),
): Promise<void> {
  const quoted = plan.tables.map((t) => `"${t}"`).join(", ");
  const reseed = plan.reference.filter(
    (r) => !START_EMPTY_TABLES.includes(r.table),
  );

  // A truncate takes the strictest lock there is on every table at once, so it
  // loses to anything still holding a row lock. Thirty-nine places in the
  // server write without awaiting the result (a last-used stamp, a delivery
  // record, an audit row), and one of those can land after the test that
  // triggered it has returned. Postgres then reports a deadlock and kills the
  // truncate, which fails an unrelated file and passes on the next run.
  // Retrying is the honest answer: a deadlock means somebody else got there
  // first, and by the next attempt the stray write has finished. Only 40P01 is
  // retried, so a lock held for good still fails as it should.
  for (let attempt = 0; ; attempt++) {
    try {
      await client.$executeRawUnsafe(
        `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`,
      );
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      const deadlock =
        code === "40P01" || /deadlock detected/i.test(String(error));
      if (!deadlock || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }

  // In foreign-key order, as global setup sorted them. The rows go back
  // exactly as the template holds them, so a test that edited a catalogue
  // entry does not hand the edit to the next one.
  for (const { table, rowsJson } of reseed) {
    await client.$executeRawUnsafe(
      `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`,
      rowsJson,
    );
  }
}

/**
 * v1.37.0 — point a session at a record the way a test needs it pointed, and
 * leave the request headers agreeing with the row.
 *
 * Every sharing fixture used to do this with a bare `session.update`. That is
 * still the write, but since the record-session fence a cookie request also has
 * to ASSERT the context it believes it is in: a session pointed at a record and
 * a request carrying no assertion is a bundle that predates the fence, and it is
 * refused with 403 before any resolver decides anything. A fixture that switched
 * and did not assert would therefore be testing the deploy-compatibility arm
 * rather than whatever it was written for.
 *
 * The assertion is read back off the row rather than computed, so it is
 * truthful by construction and cannot drift from the trigger's idea of the
 * epoch. Tests that WANT a stale or absent assertion set the headers themselves;
 * those live in `tests/integration/record-session-fence*.test.ts`.
 */
export async function switchSessionTo(
  sessionId: string,
  actingAsUserId: string | null,
): Promise<void> {
  const row = await prisma.session.update({
    where: { id: sessionId },
    data: { actingAsUserId },
  });
  assertRecordContext(row.recordEpoch, row.actingAsUserId);
}
