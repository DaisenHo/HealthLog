/**
 * The Sleep Score's rhythm sub-scores (consistency, timing) for a ring wearer
 * whose recent nights come from Oura while the phone's Apple Health history is
 * still being read from years back. The Oura month carries the periods Oura
 * really returns: a `long_sleep` most nights, short `sleep` naps, a `late_nap`
 * in the evening, a `rest` period the person rejected, and two days on which
 * the ring recorded no night at all and only a daytime nap. Rows go through
 * the real Oura mapper, so the fixture has the shape the sync writes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    measurement: { findMany: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock("@/lib/tz/resolver", () => ({
  resolveUserTimezone: vi.fn().mockResolvedValue("Europe/Berlin"),
}));

import { prisma } from "@/lib/db";
import { mapSleep, type OuraSleep } from "@/lib/oura/client";
import {
  computeSleepScore,
  reconstructNights,
  scoreConsistency,
} from "../sleep-score";

const TZ = "Europe/Berlin";
const NOW = new Date("2026-10-01T09:00:00Z");
const PROFILE = { ageYears: 40, sex: "MALE" as const };
const findMany = prisma.measurement.findMany as ReturnType<typeof vi.fn>;

interface Row {
  value: number;
  measuredAt: Date;
  sleepStage: string | null;
  source: string;
  deviceType: string | null;
}

/** A 5-minute hypnogram: awake at both ends, light / deep / REM between. */
function hypnogram(minutes: number): string {
  const n = Math.round(minutes / 5);
  const body = "2221133322224222113332";
  let s = "444";
  for (let i = 0; i < n - 5; i += 1) s += body[i % body.length];
  return s + "44";
}

function period(
  id: string,
  type: string,
  start: Date,
  minutes: number,
): OuraSleep {
  const end = new Date(start.getTime() + minutes * 60_000);
  return {
    id,
    type,
    day: end.toISOString().slice(0, 10),
    bedtime_start: start.toISOString(),
    bedtime_end: end.toISOString(),
    sleep_phase_5_min: hypnogram(minutes),
    efficiency: 90,
  };
}

/** Thirty Oura days ending the morning of NOW, plus Apple Health from 2024. */
function fixture(): Row[] {
  const periods: OuraSleep[] = [];
  for (let d = 1; d <= 30; d += 1) {
    // Bedtime 23:15 to 00:05 Berlin (21:15 to 22:05 UTC), eight hours.
    const bed = new Date(Date.UTC(2026, 8, d, 21, 15 + ((d * 17) % 50)));
    const noon = (h: number, m = 0) => new Date(Date.UTC(2026, 8, d + 1, h, m));
    if (d === 9 || d === 21) {
      // The ring spent the night on the charger: the day has only a nap.
      periods.push(period(`only-${d}`, "sleep", noon(11), 60));
    } else {
      periods.push(period(`night-${d}`, "long_sleep", bed, 480));
    }
    if (d % 5 === 0) periods.push(period(`nap-${d}`, "sleep", noon(10), 40));
    if (d % 7 === 0)
      periods.push(period(`late-${d}`, "late_nap", noon(15, 30), 45));
    if (d % 6 === 0) periods.push(period(`rest-${d}`, "rest", noon(11), 90));
  }
  const oura = periods.flatMap((p) =>
    mapSleep(p, TZ)
      .filter((m) => m.type === "SLEEP_DURATION")
      .map((m) => ({
        value: m.value,
        measuredAt: m.measuredAt,
        sleepStage: m.sleepStage ?? null,
        source: "OURA",
        deviceType: null,
      })),
  );
  // The Watch history the phone is still working through, two years back.
  const apple: Row[] = [];
  for (let d = 1; d <= 20; d += 1) {
    apple.push({
      value: 420,
      measuredAt: new Date(Date.UTC(2024, 8, d, 5, 0)),
      sleepStage: "CORE",
      source: "APPLE_HEALTH",
      deviceType: "watch",
    });
  }
  return [...apple, ...oura];
}

beforeEach(() => {
  vi.clearAllMocks();
  const rows = fixture();
  // Honour the window the way the database would.
  findMany.mockImplementation(
    async (args: { where: { measuredAt: { gte: Date } } }) =>
      rows
        .filter((r) => r.measuredAt >= args.where.measuredAt.gte)
        .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime()),
  );
});

describe("Sleep Score rhythm on an Oura month", () => {
  it("keeps a nap-only day off the clock", () => {
    const nights = reconstructNights(fixture() as never, TZ).filter(
      (n) => n.night >= "2026-09-02",
    );
    const napOnly = nights.find((n) => n.night === "2026-09-10")!;
    // The day still counts its nap...
    expect(napOnly.asleepMinutes).toBeGreaterThan(0);
    // ...but a nap is no point on the sleep rhythm.
    expect(napOnly.midpoint).toBeNull();
    const regular = nights.find((n) => n.night === "2026-09-11")!;
    expect(regular.midpoint).not.toBeNull();
  });

  it("scores the consistency of a steady sleeper, not 0", async () => {
    const result = await computeSleepScore("u1", PROFILE, { now: NOW });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const sub = (k: string) =>
      result.value.subScores.find((s) => s.key === k)!.value;
    // Bedtimes wander within 50 minutes: a regular rhythm.
    expect(sub("consistency")).toBeGreaterThanOrEqual(70);
    expect(sub("timing")).toBeGreaterThanOrEqual(60);
    // The Apple Health rows from 2024 never enter the window.
    for (const call of findMany.mock.calls) {
      expect(call[0].where.measuredAt.gte.getTime()).toBeGreaterThan(
        Date.UTC(2026, 7, 31),
      );
    }
  });

  it("still reads a truly irregular rhythm as irregular", () => {
    // Midpoints spread across the night: 01:00, 04:00, 07:00, repeated.
    const spread = Array.from({ length: 12 }, (_, i) => 60 + (i % 3) * 180);
    expect(scoreConsistency(spread)).toBe(0);
  });
});
