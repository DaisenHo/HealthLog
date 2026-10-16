/**
 * Migration 0409 drops the readable location columns, and refuses to run
 * while any row still holds one.
 *
 * The suite's database is already migrated, so each case first puts the
 * v1.42 shape back (the three readable column sets and the 0382 partial
 * indexes) inside a transaction, then runs the migration's own statements
 * against it. Every case rolls back, so the database leaves as it came.
 *
 *   - A readable home, period or day aborts the migration with a message that
 *     counts each kind, and nothing is lost: the columns and the value are
 *     still there afterwards.
 *   - Without readable values it drops the nine columns and the three
 *     indexes, and the sealed copies are untouched.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient, truncateAllTables } from "./setup";

const prisma = getPrismaClient();
const USER = "drop-plaintext-location";
const ROLLBACK = new Error("roll back the case");

const MIGRATION = readFileSync(
  resolve(
    process.cwd(),
    "prisma",
    "migrations",
    "0409_drop_plaintext_location",
    "migration.sql",
  ),
  "utf8",
);

/**
 * The migration as separate statements. A `DO $$ … $$` block carries
 * semicolons of its own, so the split honours dollar quoting; comment lines
 * are dropped first.
 */
function statements(sql: string): string[] {
  const text = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const out: string[] = [];
  let current = "";
  let inDollar = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith("$$", i)) {
      inDollar = !inDollar;
      current += "$$";
      i += 1;
      continue;
    }
    const ch = text[i];
    if (ch === ";" && !inDollar) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The readable columns and partial indexes as v1.42 left them. */
async function restoreV142Shape(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`ALTER TABLE "users"
    ADD COLUMN "home_lat" DOUBLE PRECISION,
    ADD COLUMN "home_lon" DOUBLE PRECISION,
    ADD COLUMN "home_label" TEXT`);
  await tx.$executeRawUnsafe(`ALTER TABLE "environment_travel_locations"
    ADD COLUMN "lat" DOUBLE PRECISION,
    ADD COLUMN "lon" DOUBLE PRECISION,
    ADD COLUMN "label" TEXT`);
  await tx.$executeRawUnsafe(`ALTER TABLE "environment_contexts"
    ADD COLUMN "lat" DOUBLE PRECISION,
    ADD COLUMN "lon" DOUBLE PRECISION,
    ADD COLUMN "location_label" TEXT`);
  await tx.$executeRawUnsafe(
    `CREATE INDEX "users_home_location_plain_idx" ON "users"("id") WHERE "home_lat" IS NOT NULL`,
  );
  await tx.$executeRawUnsafe(
    `CREATE INDEX "environment_travel_locations_plain_location_idx" ON "environment_travel_locations"("id") WHERE "lat" IS NOT NULL`,
  );
  await tx.$executeRawUnsafe(
    `CREATE INDEX "environment_contexts_plain_location_idx" ON "environment_contexts"("id") WHERE "lat" IS NOT NULL`,
  );
}

async function runMigration(tx: Prisma.TransactionClient): Promise<void> {
  for (const statement of statements(MIGRATION)) {
    await tx.$executeRawUnsafe(statement);
  }
}

async function columnCount(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE (table_name = 'users' AND column_name IN ('home_lat', 'home_lon', 'home_label'))
       OR (table_name = 'environment_travel_locations' AND column_name IN ('lat', 'lon', 'label'))
       OR (table_name = 'environment_contexts' AND column_name IN ('lat', 'lon', 'location_label'))`;
  return Number(rows[0].n);
}

async function plainIndexCount(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_indexes
    WHERE indexname IN (
      'users_home_location_plain_idx',
      'environment_travel_locations_plain_location_idx',
      'environment_contexts_plain_location_idx'
    )`;
  return Number(rows[0].n);
}

/** Run `body` in a transaction that always rolls back. */
async function inRolledBackCase(
  body: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await expect(
    prisma.$transaction(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    }),
  ).rejects.toBe(ROLLBACK);
}

/** The migration's outcome inside a savepoint, so the case can look after it. */
async function attempt(tx: Prisma.TransactionClient): Promise<Error | null> {
  await tx.$executeRawUnsafe("SAVEPOINT migration_0409");
  try {
    await runMigration(tx);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT migration_0409");
    return null;
  } catch (err) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT migration_0409");
    return err instanceof Error ? err : new Error(String(err));
  }
}

beforeAll(async () => {
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: { id: USER, username: USER, email: `${USER}@example.test` },
  });
});

afterAll(async () => {
  await truncateAllTables(prisma);
});

describe("migration 0409 (drop the readable location columns)", () => {
  it("is split into its guard and its drops", () => {
    const parts = statements(MIGRATION);
    expect(parts[0]).toMatch(/^DO \$\$/);
    expect(parts[0]).toContain("RAISE EXCEPTION");
    // The guard runs before anything is dropped.
    expect(parts.slice(1).every((s) => /^(DROP|ALTER)/.test(s))).toBe(true);
    expect(parts.length).toBeGreaterThan(3);
  });

  it("stops on a readable home, names the counts, and loses nothing", async () => {
    await inRolledBackCase(async (tx) => {
      await restoreV142Shape(tx);
      await tx.$executeRawUnsafe(
        `UPDATE "users" SET "home_lat" = 51.5, "home_lon" = 7.2, "home_label" = 'Bochum' WHERE "id" = $1`,
        USER,
      );

      const error = await attempt(tx);
      expect(error?.message).toMatch(/HealthLog migration 0409 stopped/);
      expect(error?.message).toMatch(
        /1 home location\(s\), 0 location period\(s\) and 0 daily location\(s\)/,
      );
      // The operator reads this line in the container log; it points at the
      // recovery steps, which exist.
      expect(error?.message).toMatch(
        /docs\/ops\/migration-0409-plaintext-location\.md/,
      );
      expect(
        existsSync(
          resolve(
            process.cwd(),
            "docs/ops/migration-0409-plaintext-location.md",
          ),
        ),
      ).toBe(true);

      // Nothing was dropped and the value is where it was.
      expect(await columnCount(tx)).toBe(9);
      expect(await plainIndexCount(tx)).toBe(3);
      const rows = await tx.$queryRawUnsafe<{ home_lat: number }[]>(
        `SELECT "home_lat" FROM "users" WHERE "id" = $1`,
        USER,
      );
      expect(rows[0].home_lat).toBe(51.5);
    });
  });

  it("counts readable periods and days as well", async () => {
    await inRolledBackCase(async (tx) => {
      await restoreV142Shape(tx);
      await tx.$executeRawUnsafe(
        `INSERT INTO "environment_travel_locations" ("id", "user_id", "start_date", "end_date", "lat", "lon", "label", "updated_at")
         VALUES ('t1', $1, '2026-05-01', '2026-05-03', 38.7, -9.1, 'Lisbon', now()),
                ('t2', $1, '2026-06-01', '2026-06-03', 41.4, 2.2, 'Barcelona', now())`,
        USER,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "environment_contexts" ("id", "user_id", "date", "source", "lat", "lon", "location_label", "updated_at")
         VALUES ('d1', $1, '2026-05-01', 'TRAVEL', 38.7, -9.1, 'Lisbon', now())`,
        USER,
      );

      const error = await attempt(tx);
      expect(error?.message).toMatch(
        /0 home location\(s\), 2 location period\(s\) and 1 daily location\(s\)/,
      );
      expect(await columnCount(tx)).toBe(9);
    });
  });

  it("drops the columns and indexes when no readable value is left, sealed rows untouched", async () => {
    await inRolledBackCase(async (tx) => {
      await restoreV142Shape(tx);
      const sealed = new Uint8Array([2, 1, 2, 3]);
      await tx.environmentTravelLocation.create({
        data: {
          id: "sealed-period",
          userId: USER,
          startDate: "2026-07-01",
          endDate: "2026-07-02",
          locationEncrypted: sealed,
        },
      });

      expect(await attempt(tx)).toBeNull();
      expect(await columnCount(tx)).toBe(0);
      expect(await plainIndexCount(tx)).toBe(0);
      const kept = await tx.environmentTravelLocation.findUnique({
        where: { id: "sealed-period" },
      });
      expect(Buffer.from(kept!.locationEncrypted!)).toEqual(
        Buffer.from(sealed),
      );
    });
  });

  it("leaves the migrated database as it found it", async () => {
    expect(await columnCount(prisma as Prisma.TransactionClient)).toBe(0);
    expect(await plainIndexCount(prisma as Prisma.TransactionClient)).toBe(0);
  });
});
