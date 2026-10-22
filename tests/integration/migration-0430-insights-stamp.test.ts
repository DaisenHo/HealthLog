/**
 * Migration 0430 drops the readable copy of the cached insights payload. A row
 * whose only copy was the readable one keeps no text afterwards, so the same
 * migration clears its `insights_cached_at` stamp: the nightly pregenerate
 * selects `insights_cached_at IS NULL OR < stale`, and a fresh stamp over an
 * empty cache would have kept the card empty for the whole staleness window.
 *
 * The schema here is already migrated; the statement is replayed from the
 * migration file against rows seeded in both shapes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { getPrismaClient, truncateAllTables } from "./setup";

const MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/0430_drop_insights_cached_text/migration.sql",
);

function stampStatement(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf('UPDATE "users"');
  if (start < 0) throw new Error("0430 carries no stamp reset");
  return sql.slice(start, sql.indexOf(";", start) + 1);
}

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
});

describe("migration 0430 clears the stamp of an emptied cache", () => {
  it("resets the stamp only where no sealed payload is left", async () => {
    const prisma = getPrismaClient();
    const stamp = new Date("2026-10-20T04:30:00Z");
    await prisma.user.create({
      data: {
        id: "emptied",
        username: "emptied",
        email: "emptied@example.test",
        role: "USER",
        insightsCachedAt: stamp,
        insightsCachedTextEncrypted: null,
      },
    });
    await prisma.user.create({
      data: {
        id: "sealed",
        username: "sealed",
        email: "sealed@example.test",
        role: "USER",
        insightsCachedAt: stamp,
        insightsCachedTextEncrypted: new Uint8Array([1, 2, 3]),
      },
    });

    await prisma.$executeRawUnsafe(stampStatement());

    const rows = await prisma.user.findMany({
      where: { id: { in: ["emptied", "sealed"] } },
      select: { id: true, insightsCachedAt: true },
      orderBy: { id: "asc" },
    });
    expect(rows).toEqual([
      { id: "emptied", insightsCachedAt: null },
      { id: "sealed", insightsCachedAt: stamp },
    ]);
  });
});
