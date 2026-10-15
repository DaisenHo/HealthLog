/**
 * Oura sleep periods the person rejected (`rest`) or deleted: against the
 * real schema, retiring one soft-deletes every live OURA row under its record
 * prefix, whatever the type, leaves a counted sleep period and the other
 * sources alone, and recomputes the rollup day so the day stops counting the
 * retired reading.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { recomputeBucketsForMeasurement } from "@/lib/rollups/measurement-rollups";

import { getPrismaClient, truncateAllTables } from "./setup";

const USER = "user-oura-retired-sleep";
const END = new Date(Date.UTC(2026, 5, 10, 15, 0, 0));
const NIGHT_END = new Date(Date.UTC(2026, 5, 10, 7, 0, 0));

beforeEach(async () => {
  const prisma = getPrismaClient();
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: {
      id: USER,
      username: "oura-retired-sleep",
      email: "oura-retired-sleep@example.test",
    },
  });
  const row = (
    type: "SLEEP_DURATION" | "RESTING_HEART_RATE",
    externalId: string,
    value: number,
    measuredAt: Date,
    source: "OURA" | "APPLE_HEALTH" = "OURA",
  ) => ({
    userId: USER,
    type,
    value,
    unit: type === "SLEEP_DURATION" ? "minutes" : "bpm",
    measuredAt,
    source,
    externalId,
    sleepStage: type === "SLEEP_DURATION" ? ("CORE" as const) : null,
  });
  await prisma.measurement.createMany({
    data: [
      // The rejected afternoon period: a stage row and its nightly scalar.
      row(
        "SLEEP_DURATION",
        "sleep:rec-rest:seg:2026-06-10T14:00:00.000Z",
        60,
        END,
      ),
      row("RESTING_HEART_RATE", "sleep:rec-rest:rhr", 58, END),
      // The real night before it, same day.
      row(
        "SLEEP_DURATION",
        "sleep:rec-night:seg:2026-06-09T23:00:00.000Z",
        480,
        NIGHT_END,
      ),
      row("RESTING_HEART_RATE", "sleep:rec-night:rhr", 48, NIGHT_END),
      // Another source's row whose id happens to share the prefix shape.
      row("RESTING_HEART_RATE", "sleep:rec-rest:rhr", 52, END, "APPLE_HEALTH"),
    ],
  });
  await recomputeBucketsForMeasurement(USER, "RESTING_HEART_RATE", END);
});

describe("retireOuraSleepRecords", () => {
  it("retires only the rejected period's OURA rows and recomputes the day", async () => {
    const prisma = getPrismaClient();
    const { retireOuraSleepRecords } = await import("@/lib/oura/sync");

    const before = await prisma.measurementRollup.findFirst({
      where: {
        userId: USER,
        type: "RESTING_HEART_RATE",
        granularity: "DAY",
        source: "OURA",
      },
    });
    expect(before?.count).toBe(2);

    const removed = await retireOuraSleepRecords(USER, ["sleep:rec-rest:"]);
    expect(removed).toBe(2);

    const live = await prisma.measurement.findMany({
      where: { userId: USER, deletedAt: null },
      select: { externalId: true, source: true },
    });
    const key = (r: { externalId: string | null; source: string }) =>
      `${r.source}|${r.externalId}`;
    expect(live.sort((a, b) => key(a).localeCompare(key(b)))).toEqual([
      { externalId: "sleep:rec-rest:rhr", source: "APPLE_HEALTH" },
      { externalId: "sleep:rec-night:rhr", source: "OURA" },
      {
        externalId: "sleep:rec-night:seg:2026-06-09T23:00:00.000Z",
        source: "OURA",
      },
    ]);

    const after = await prisma.measurementRollup.findFirst({
      where: {
        userId: USER,
        type: "RESTING_HEART_RATE",
        granularity: "DAY",
        source: "OURA",
      },
    });
    expect(after?.count).toBe(1);
    expect(after?.mean).toBe(48);

    // A malformed prefix never widens to the whole source.
    expect(await retireOuraSleepRecords(USER, ["sleep::", "sleep:"])).toBe(0);
  });
});
