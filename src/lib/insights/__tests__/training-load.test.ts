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
    });
  });

  it("counts a day without a stored row as a rest day", () => {
    // Train on day 0 only, then 29 empty days up to day 29.
    const load = computeTrainingLoad(
      [
        { day: day(0), dayTrimp: 84 },
        { day: day(1), dayTrimp: 42 },
        { day: day(2), dayTrimp: 42 },
      ],
      day(29),
    );
    if (load.status !== "ok") throw new Error("expected ok");
    let ctl = 0;
    let atl = 0;
    for (let i = 0; i < 30; i += 1) {
      const l = i === 0 ? 84 : i < 3 ? 42 : 0;
      ctl += (l - ctl) / 42;
      atl += (l - atl) / 7;
    }
    expect(load.ctl).toBe(Math.round(ctl * 10) / 10);
    expect(load.atl).toBe(Math.round(atl * 10) / 10);
    expect(load.daysCovered).toBe(30);
    expect(load.warmingUp).toBe(true);
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
  it("describes the day the strain run scored", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const findMany = vi.fn(async () => []);
    vi.doMock("@/lib/db", () => ({
      prisma: { strainTrimpCache: { findMany } },
    }));
    const { readTrainingLoad } = await import("../training-load");
    const { scoreDayKey } = await import("@/lib/insights/score-row");
    const now = new Date("2026-10-21T01:30:00.000Z");
    await readTrainingLoad("u1", now);
    const args = (findMany.mock.calls[0] as unknown[])[0] as {
      where: { day: { lte: string } };
    };
    expect(args.where.day.lte).toBe(scoreDayKey(now));
    vi.doUnmock("@/lib/db");
  });
});
