/**
 * The latest canonical reading per type, against a real Postgres.
 *
 * `readLatestCanonical` replaced five `DISTINCT ON (type)` reads that sorted
 * every row of the account. The contract it keeps: the latest UTC day decides,
 * inside it the source ladder decides (Withings outranks Apple Health for
 * weight), inside the winning source the latest reading; a type with no
 * reading drops out, and `since` drops a type whose latest reading is older.
 * The day window is closed: an older day of the ladder winner never beats a
 * newer day of a lower source.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { getPrismaClient, truncateAllTables } from "./setup";
import { readLatestCanonical } from "@/lib/measurements/latest-canonical";

const prisma = getPrismaClient();
const USER = "latest-canonical";
const now = new Date();
/** UTC midnight two days back. */
const D = Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  now.getUTCDate() - 2,
);
const at = (day: number, hour: number) =>
  new Date(D + day * 86_400_000 + hour * 3_600_000);

beforeAll(async () => {
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: { id: USER, username: USER, email: `${USER}@example.test` },
  });
  const rows: Array<[string, string, number, Date, string]> = [
    // WEIGHT: the latest day holds Apple at 20:00 and Withings at 07:00;
    // Withings ranks first, so 82 wins over the later 81.
    ["WEIGHT", "WITHINGS", 80, at(-1, 8), "kg"],
    ["WEIGHT", "WITHINGS", 82, at(0, 7), "kg"],
    ["WEIGHT", "APPLE_HEALTH", 81, at(0, 20), "kg"],
    // BODY_FAT: Withings is the ladder winner but only on an older day; the
    // newer Apple day wins.
    ["BODY_FAT", "WITHINGS", 20, at(-1, 8), "%"],
    ["BODY_FAT", "APPLE_HEALTH", 21, at(0, 9), "%"],
    // PULSE: one source, the latest reading of the latest day.
    ["PULSE", "APPLE_HEALTH", 60, at(0, 6), "bpm"],
    ["PULSE", "APPLE_HEALTH", 64, at(0, 22), "bpm"],
    // BLOOD_GLUCOSE: only a reading far in the past.
    ["BLOOD_GLUCOSE", "MANUAL", 95, new Date(D - 200 * 86_400_000), "mg/dL"],
  ];
  await prisma.measurement.createMany({
    data: rows.map(([type, source, value, measuredAt, unit], i) => ({
      id: `${USER}-${i}`,
      userId: USER,
      type: type as "WEIGHT",
      source: source as "WITHINGS",
      value,
      unit,
      measuredAt,
    })),
  });
  // A deleted later reading never counts.
  await prisma.measurement.create({
    data: {
      id: `${USER}-deleted`,
      userId: USER,
      type: "PULSE",
      source: "APPLE_HEALTH",
      value: 99,
      unit: "bpm",
      measuredAt: at(0, 23),
      deletedAt: new Date(),
    },
  });
});

describe("readLatestCanonical", () => {
  it("picks the latest day, then the ladder, then the latest reading", async () => {
    const rows = await readLatestCanonical(USER, null);
    const byType = new Map(rows.map((r) => [r.type, r]));
    expect([...byType.keys()].sort()).toEqual([
      "BLOOD_GLUCOSE",
      "BODY_FAT",
      "PULSE",
      "WEIGHT",
    ]);
    expect(byType.get("WEIGHT")?.value).toBe(82);
    expect(byType.get("WEIGHT")?.measured_at.toISOString()).toBe(
      at(0, 7).toISOString(),
    );
    expect(byType.get("BODY_FAT")?.value).toBe(21);
    expect(byType.get("PULSE")?.value).toBe(64);
    expect(byType.get("BLOOD_GLUCOSE")?.value).toBe(95);
  });

  it("drops a type whose latest reading is older than `since`", async () => {
    const rows = await readLatestCanonical(
      USER,
      null,
      new Date(Date.now() - 90 * 86_400_000),
    );
    expect(rows.map((r) => r.type).sort()).toEqual([
      "BODY_FAT",
      "PULSE",
      "WEIGHT",
    ]);
  });

  it("honours a stored source order", async () => {
    const rows = await readLatestCanonical(USER, {
      weight: ["APPLE_HEALTH", "WITHINGS"],
    });
    expect(rows.find((r) => r.type === "WEIGHT")?.value).toBe(81);
  });
});
