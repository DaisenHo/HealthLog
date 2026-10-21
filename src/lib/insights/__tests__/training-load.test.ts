import { describe, expect, it } from "vitest";

import { shiftDateKey } from "@/lib/tz/format";
import { computeTrainingLoad } from "../training-load";

const D0 = "2026-01-01";
const day = (n: number) => shiftDateKey(D0, n);

describe("computeTrainingLoad", () => {
  it("matches the closed form for a constant daily impulse", () => {
    // 100 every day for 60 days: CTL = 100·(1 − (41/42)^60),
    // ATL = 100·(1 − (6/7)^60).
    const rows = Array.from({ length: 60 }, (_, i) => ({
      day: day(i),
      dayTrimp: 100,
    }));
    const load = computeTrainingLoad(rows, day(59));
    if (load.status !== "ok") throw new Error("expected ok");
    const ctl = 100 * (1 - (41 / 42) ** 60);
    const atl = 100 * (1 - (6 / 7) ** 60);
    expect(load.ctl).toBe(Math.round(ctl * 10) / 10);
    expect(load.atl).toBe(Math.round(atl * 10) / 10);
    expect(load.tsb).toBe(Math.round((ctl - atl) * 10) / 10);
    expect(load.daysCovered).toBe(60);
    expect(load.trainingDays).toBe(60);
    expect(load.warmingUp).toBe(false);
    expect(load.series).toHaveLength(60);
    // Form on day 0 is taken going into the day: both averages are still 0.
    expect(load.series[0]).toEqual({
      day: day(0),
      ctl: 2.4,
      atl: 14.3,
      tsb: 0,
      rated: true,
    });
    expect(load.recentRatedDays).toBe(42);
    expect(load.recentDays).toBe(42);
  });

  it("counts a scored day of 0 as rest, and holds through a day never scored", () => {
    // Three training days, then scored rest days 3..29 except a gap of
    // unscored days 10..19 (no heart-rate data reached the server).
    const rows = [
      { day: day(0), dayTrimp: 84 },
      { day: day(1), dayTrimp: 42 },
      { day: day(2), dayTrimp: 42 },
    ];
    for (let i = 3; i < 30; i += 1) {
      if (i < 10 || i > 19) rows.push({ day: day(i), dayTrimp: 0 });
    }
    const load = computeTrainingLoad(rows, day(29));
    if (load.status !== "ok") throw new Error("expected ok");
    let ctl = 0;
    let atl = 0;
    for (let i = 0; i < 30; i += 1) {
      if (i >= 10 && i <= 19) continue; // held
      const l = i === 0 ? 84 : i < 3 ? 42 : 0;
      ctl += (l - ctl) / 42;
      atl += (l - atl) / 7;
    }
    expect(load.ctl).toBe(Math.round(ctl * 10) / 10);
    expect(load.atl).toBe(Math.round(atl * 10) / 10);
    expect(load.daysCovered).toBe(30);
    expect(load.recentRatedDays).toBe(20);
    expect(load.recentDays).toBe(30);
    expect(load.series.find((p) => p.day === day(12))?.rated).toBe(false);
    expect(load.series.find((p) => p.day === day(25))?.rated).toBe(true);
    expect(load.warmingUp).toBe(true);
  });

  it("holds through days not yet scored and names the last rated day", () => {
    // Rows through day 39; asked for day 41 (the nightly run for 40 and 41
    // has not happened, and nothing else is known about them). The figures
    // are those of day 39 and the series still runs to day 41.
    const rows = Array.from({ length: 40 }, (_, i) => ({
      day: day(i),
      dayTrimp: 60,
    }));
    const late = computeTrainingLoad(rows, day(41));
    const exact = computeTrainingLoad(rows, day(39));
    if (late.status !== "ok" || exact.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(late.asOf).toBe(day(39));
    expect(late.ctl).toBe(exact.ctl);
    expect(late.atl).toBe(exact.atl);
    expect(late.tsb).toBe(exact.tsb);
    expect(late.series.at(-1)).toMatchObject({ day: day(41), rated: false });
    expect(late.recentRatedDays).toBe(40);
    expect(late.recentDays).toBe(42);
  });

  it("reads a day with activity data and no workout as rest", () => {
    // Training days 0..2, stored rest days 3..9, then no rows at all from
    // day 10 on: the strain run writes none on a day without active energy.
    // Days 10..59 carry steps or heart rate, except a workout on day 20 that
    // could not be scored and an empty day 30.
    const rows = [
      { day: day(0), dayTrimp: 84 },
      { day: day(1), dayTrimp: 42 },
      { day: day(2), dayTrimp: 42 },
    ];
    for (let i = 3; i < 10; i += 1) rows.push({ day: day(i), dayTrimp: 0 });
    const dataDays = new Set<string>();
    for (let i = 10; i < 60; i += 1) if (i !== 30) dataDays.add(day(i));
    const load = computeTrainingLoad(rows, day(59), {
      dataDays,
      workoutDays: new Set([day(20)]),
    });
    if (load.status !== "ok") throw new Error("expected ok");
    let ctl = 0;
    let atl = 0;
    for (let i = 0; i < 60; i += 1) {
      if (i === 20 || i === 30) continue; // held
      const l = i === 0 ? 84 : i < 3 ? 42 : 0;
      ctl += (l - ctl) / 42;
      atl += (l - atl) / 7;
    }
    expect(load.asOf).toBe(day(59));
    expect(load.ctl).toBe(Math.round(ctl * 10) / 10);
    expect(load.atl).toBe(Math.round(atl * 10) / 10);
    expect(load.series.find((p) => p.day === day(15))?.rated).toBe(true);
    expect(load.series.find((p) => p.day === day(20))?.rated).toBe(false);
    expect(load.series.find((p) => p.day === day(30))?.rated).toBe(false);
    expect(load.recentRatedDays).toBe(40);
    expect(load.recentDays).toBe(42);
    // Without the activity data the same rows would hold from day 10 on.
    const blind = computeTrainingLoad(rows, day(59));
    if (blind.status !== "ok") throw new Error("expected ok");
    expect(blind.asOf).toBe(day(9));
    expect(load.ctl).toBeLessThan(blind.ctl);
  });

  it("runs the series to the end and counts a trailing gap as unrated", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      day: day(i),
      dayTrimp: 60,
    }));
    const load = computeTrainingLoad(rows, day(119));
    if (load.status !== "ok") throw new Error("expected ok");
    expect(load.asOf).toBe(day(39));
    expect(load.series.at(-1)?.day).toBe(day(119));
    expect(load.recentRatedDays).toBe(0);
    expect(load.recentDays).toBe(42);
    expect(load.daysCovered).toBe(120);
  });

  it("answers insufficient without impulse or with too little history", () => {
    expect(computeTrainingLoad([], day(10))).toMatchObject({
      status: "insufficient",
      reason: "no_impulse_history",
    });
    expect(
      computeTrainingLoad([{ day: day(0), dayTrimp: 0 }], day(40)),
    ).toMatchObject({ status: "insufficient", reason: "no_impulse_history" });
    expect(
      computeTrainingLoad(
        Array.from({ length: 10 }, (_, i) => ({ day: day(i), dayTrimp: 50 })),
        day(9),
      ),
    ).toMatchObject({
      status: "insufficient",
      reason: "too_little_history",
      daysCovered: 10,
    });
  });

  it("ignores rows after the day it describes", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      day: day(i),
      dayTrimp: 60,
    }));
    const a = computeTrainingLoad(rows, day(29));
    const b = computeTrainingLoad(rows.slice(0, 30), day(29));
    expect(a).toEqual(b);
  });
});

describe("readTrainingLoad", () => {
  it("describes the day the strain run scored and reads activity days as rest", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const now = new Date("2026-10-21T01:30:00.000Z");
    const { scoreDayKey } = await import("@/lib/insights/score-row");
    const until = scoreDayKey(now);
    const first = shiftDateKey(until, -59);
    const cache = Array.from({ length: 10 }, (_, i) => ({
      day: shiftDateKey(first, i),
      dayTrimp: i < 3 ? 80 : 0,
    }));
    const strainFindMany = vi.fn(async () => cache);
    // Steps on every day after the stored rows; one workout on the last day.
    const rollupFindMany = vi.fn(async () =>
      Array.from({ length: 50 }, (_, i) => ({
        bucketStart: new Date(`${shiftDateKey(first, 10 + i)}T00:00:00.000Z`),
      })),
    );
    const queryRaw = vi.fn(async () => [{ day: until }]);
    vi.doMock("@/lib/db", () => ({
      prisma: {
        strainTrimpCache: { findMany: strainFindMany },
        measurementRollup: { findMany: rollupFindMany },
        $queryRaw: queryRaw,
      },
    }));
    const { readTrainingLoad } = await import("../training-load");
    const load = await readTrainingLoad("u1", now);
    const args = (strainFindMany.mock.calls[0] as unknown[])[0] as {
      where: { day: { lte: string } };
    };
    expect(args.where.day.lte).toBe(until);
    if (load.status !== "ok") throw new Error("expected ok");
    expect(load.series.at(-1)).toMatchObject({ day: until, rated: false });
    expect(load.asOf).toBe(shiftDateKey(until, -1));
    expect(load.recentRatedDays).toBe(41);
    vi.doUnmock("@/lib/db");
  });
});
