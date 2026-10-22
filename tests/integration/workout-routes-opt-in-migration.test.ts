/**
 * Migration 0434: an account that already holds a stored workout track keeps
 * the route opt-in ON after the upgrade; an account without one starts OFF.
 *
 * The container applies every migration before any row exists, so the test
 * seeds both kinds of account and runs the migration's UPDATE again, read
 * from the migration file itself rather than copied, so it tests the shipped
 * statement.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { getPrismaClient, truncateAllTables } from "./setup";

const MIGRATION = join(
  process.cwd(),
  "prisma/migrations/0434_workout_routes_keep_and_climb_cursor/migration.sql",
);

function shippedUpdate(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = /UPDATE "users"[\s\S]*?;\n/.exec(sql);
  if (!match) throw new Error("0434 carries no UPDATE of users");
  return match[0];
}

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
});

describe("0434 — route opt-in for accounts that already keep tracks", () => {
  it("turns it on only where a track is stored", async () => {
    const prisma = getPrismaClient();
    for (const id of ["with-route", "without-route", "workout-no-route"]) {
      await prisma.user.create({
        data: { id, username: id, email: `${id}@example.test` },
      });
    }
    const started = new Date("2026-09-01T07:00:00Z");
    const ended = new Date("2026-09-01T08:00:00Z");
    const withRoute = await prisma.workout.create({
      data: {
        userId: "with-route",
        sportType: "running",
        startedAt: started,
        endedAt: ended,
        durationSec: 3600,
        source: "APPLE_HEALTH",
        externalId: "w-1",
      },
    });
    await prisma.workoutRoute.create({
      data: {
        workoutId: withRoute.id,
        geometryEncrypted: Buffer.from("sealed"),
      },
    });
    await prisma.workout.create({
      data: {
        userId: "workout-no-route",
        sportType: "running",
        startedAt: started,
        endedAt: ended,
        durationSec: 3600,
        source: "APPLE_HEALTH",
        externalId: "w-2",
      },
    });

    await prisma.$executeRawUnsafe(shippedUpdate());

    const flags = Object.fromEntries(
      (
        await prisma.user.findMany({
          select: { id: true, storeWorkoutRoutes: true },
        })
      ).map((u) => [u.id, u.storeWorkoutRoutes]),
    );
    expect(flags).toEqual({
      "with-route": true,
      "without-route": false,
      "workout-no-route": false,
    });
  });
});
