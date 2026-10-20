/**
 * Retiring an index on `measurements` without the boot waiting on the table.
 *
 * Migration 0416 drops `measurements_user_id_type_measured_at_idx` only when
 * the lock is there at once and otherwise leaves it, successfully; the
 * nightly measurement maintenance drops what is left with
 * `DROP INDEX CONCURRENTLY IF EXISTS` under a bounded lock wait. Proven here
 * against Postgres, each with the transaction that used to hold the boot:
 * the migration finishes while a reader holds the table and drops the index
 * once it does not; the maintenance step gives up within its wait, puts the
 * session's lock timeout back, and drops the index on the next run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAINTENANCE_SESSION_OPTIONS,
  RETIRED_MEASUREMENT_INDEXES,
  runMeasurementMaintenance,
} from "@/lib/jobs/measurement-maintenance";

const INDEX = "measurements_user_id_type_measured_at_idx";
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/0416_drop_measurements_type_prefix_index/migration.sql",
  ),
  "utf8",
);

function connect(options?: string): Client {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.searchParams.delete("schema");
  return new Client({ connectionString: url.toString(), options });
}

async function present(db: Client): Promise<boolean> {
  const { rows } = await db.query<{ present: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [INDEX],
  );
  return rows[0].present;
}

let db: Client;
let holder: Client;

beforeEach(async () => {
  db = connect(MAINTENANCE_SESSION_OPTIONS);
  holder = connect();
  await db.connect();
  await holder.connect();
  // The state on an instance that has not run 0416 yet.
  await db.query(
    `CREATE INDEX IF NOT EXISTS "${INDEX}" ON "measurements" ("user_id", "type", "measured_at")`,
  );
});

afterEach(async () => {
  await holder.query("ROLLBACK").catch(() => {});
  await holder.end();
  await db.query(`DROP INDEX IF EXISTS "${INDEX}"`);
  await db.end();
});

describe("migration 0416", () => {
  it("finishes while a reader holds the table and leaves the index", async () => {
    await holder.query("BEGIN");
    await holder.query(`SELECT count(*) FROM "measurements"`);

    const startedAt = Date.now();
    await db.query(MIGRATION);

    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(await present(db)).toBe(true);
  });

  it("counter-check: drops the index when nothing holds the table", async () => {
    await db.query(MIGRATION);
    expect(await present(db)).toBe(false);
    // And again, as a retried boot would.
    await db.query(MIGRATION);
  });
});

describe("the maintenance step for a retired index", () => {
  it("names the index the migration retires", () => {
    expect(RETIRED_MEASUREMENT_INDEXES).toContain(INDEX);
  });

  it("gives up within its wait, restores the session, and drops it on the next run", async () => {
    await holder.query("BEGIN");
    await holder.query(
      `LOCK TABLE "measurements" IN SHARE UPDATE EXCLUSIVE MODE`,
    );

    const blocked = await runMeasurementMaintenance(
      db,
      { vacuum: false, reindex: false },
      { retiredLockTimeout: "300ms" },
    );
    expect(blocked.outcome).toBe("nothing_due");
    expect(blocked.steps).toEqual([
      expect.objectContaining({
        step: "drop_retired",
        target: INDEX,
        ok: false,
        error: expect.stringContaining("55P03"),
      }),
    ]);
    // The session's own wait (five minutes) is back for the rest of the run.
    const { rows } = await db.query<{ value: string }>(
      `SELECT current_setting('lock_timeout') AS value`,
    );
    expect(rows[0].value).toBe("5min");

    await holder.query("ROLLBACK");
    const next = await runMeasurementMaintenance(db, {
      vacuum: false,
      reindex: false,
    });
    expect(next.steps).toEqual([
      expect.objectContaining({
        step: "drop_retired",
        target: INDEX,
        ok: true,
      }),
    ]);
    expect(await present(db)).toBe(false);

    // Gone: the run after that has nothing to do.
    const after = await runMeasurementMaintenance(db, {
      vacuum: false,
      reindex: false,
    });
    expect(after.steps).toEqual([]);
  });
});
