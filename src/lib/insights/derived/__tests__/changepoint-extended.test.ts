import { beforeEach, describe, expect, it, vi } from "vitest";

const readDayMeanSeries = vi.fn();
vi.mock("@/lib/insights/derived/baseline", () => ({
  readDayMeanSeries: (...args: unknown[]) => readDayMeanSeries(...args),
}));
vi.mock("@/lib/rollups/measurement-coverage", () => ({
  probeRollupCoverage: vi.fn(async () => new Map()),
}));

import {
  buildChangepointSignals,
  buildExtendedChangepointSignals,
  CHANGEPOINT_FLOORS,
  CHANGEPOINT_WINDOW_DAYS,
  detectLevelShift,
  MAX_MAGNITUDE,
  EXTENDED_CHANGEPOINT_METRICS,
  EXTENDED_CHANGEPOINT_WINDOW_DAYS,
} from "../changepoint";
import { shiftDateKey } from "@/lib/tz/format";

const NOW = new Date("2026-10-21T08:00:00.000Z");

/** 20 days at `a`, then 20 at `b`, a day apart from 2026-06-01. */
function step(a: number, b: number) {
  return Array.from({ length: 40 }, (_, i) => ({
    day: shiftDateKey("2026-06-01", i),
    mean: i < 20 ? a : b,
  }));
}

beforeEach(() => {
  readDayMeanSeries.mockReset();
});

describe("buildExtendedChangepointSignals", () => {
  it("scans every extended metric over 180 days and reports segment sizes", async () => {
    readDayMeanSeries.mockImplementation(async (_u: string, metric: string) =>
      metric === "RESPIRATORY_RATE"
        ? { points: step(14, 17), source: "DAY" }
        : { points: [], source: "DAY" },
    );
    const shifts = await buildExtendedChangepointSignals("u1", NOW, {});
    const read = readDayMeanSeries.mock.calls.map((c) => c[1]);
    expect(read).toEqual([...EXTENDED_CHANGEPOINT_METRICS]);
    for (const call of readDayMeanSeries.mock.calls) {
      expect(call[2]).toBe(EXTENDED_CHANGEPOINT_WINDOW_DAYS);
    }
    expect(shifts).toEqual([
      expect.objectContaining({
        metric: "RESPIRATORY_RATE",
        breakDate: "2026-06-21",
        beforeMean: 14,
        afterMean: 17,
        direction: "up",
        beforeDays: 20,
        afterDays: 20,
      }),
    ]);
  });

  it("leaves a metric unread when its module is off", async () => {
    readDayMeanSeries.mockResolvedValue({ points: [], source: "DAY" });
    await buildExtendedChangepointSignals("u1", NOW, {
      recovery: false,
      glucose: false,
    });
    const read = readDayMeanSeries.mock.calls.map((c) => c[1]);
    expect(read).not.toContain("HRV_RMSSD");
    expect(read).not.toContain("RESTING_HEART_RATE");
    expect(read).not.toContain("BLOOD_GLUCOSE");
    expect(read).toContain("WEIGHT");
  });

  it("caps at five, strongest first", async () => {
    let k = 0;
    readDayMeanSeries.mockImplementation(async () => {
      k += 1;
      return { points: step(10, 10 + k), source: "DAY" };
    });
    const shifts = await buildExtendedChangepointSignals("u1", NOW, {});
    expect(shifts).toHaveLength(5);
    const magnitudes = shifts.map((s) => s.magnitude);
    expect([...magnitudes].sort((a, b) => b - a)).toEqual(magnitudes);
  });
});

describe("buildChangepointSignals (the Coach's scan)", () => {
  it("keeps five metrics, 90 days and its shape", async () => {
    readDayMeanSeries.mockResolvedValue({
      points: step(56, 63),
      source: "DAY",
    });
    const shifts = await buildChangepointSignals("u1", NOW);
    expect(readDayMeanSeries).toHaveBeenCalledTimes(5);
    expect(readDayMeanSeries.mock.calls[0][2]).toBe(CHANGEPOINT_WINDOW_DAYS);
    expect(shifts).toHaveLength(2);
    expect(Object.keys(shifts[0]).sort()).toEqual([
      "afterMean",
      "beforeMean",
      "breakDate",
      "direction",
      "magnitude",
      "metric",
    ]);
  });
});

/** One metric's series, every other metric empty. */
function only(metric: string, means: number[]) {
  readDayMeanSeries.mockImplementation(async (_u: string, m: string) =>
    m === metric
      ? {
          points: means.map((mean, i) => ({
            day: shiftDateKey("2026-04-01", i),
            mean,
          })),
          source: "DAY",
        }
      : { points: [], source: "DAY" },
  );
}

describe("false-positive floors", () => {
  it("gives every extended metric a floor", () => {
    for (const metric of EXTENDED_CHANGEPOINT_METRICS) {
      expect(CHANGEPOINT_FLOORS[metric], metric).toBeDefined();
    }
  });

  it("does not call a VO2 max estimate stepping by 0.3 a shift", async () => {
    // 60 days at 40.0, 60 at 40.3: each plateau flat, so the raw detector
    // sees a near-infinite magnitude.
    const plateau = [
      ...Array<number>(60).fill(40),
      ...Array<number>(60).fill(40.3),
    ];
    expect(detectLevelShift(plateau)).not.toBeNull();
    only("VO2_MAX", plateau);
    expect(await buildExtendedChangepointSignals("u1", NOW, {})).toEqual([]);
    // A real change in the estimate still fires.
    only("VO2_MAX", [
      ...Array<number>(60).fill(40),
      ...Array<number>(60).fill(43),
    ]);
    // Measured against the 0.5 resolution floor, not a spread of zero:
    // 3 / 0.5 = 6 σ, not the cap.
    expect(await buildExtendedChangepointSignals("u1", NOW, {})).toEqual([
      expect.objectContaining({
        metric: "VO2_MAX",
        direction: "up",
        magnitude: 6,
      }),
    ]);
  });

  it("needs a change worth noting, not just a clean one", async () => {
    // Resting heart rate 60 → 62: clean, but under the 3 bpm floor.
    only("RESTING_HEART_RATE", [
      ...Array<number>(60).fill(60),
      ...Array<number>(60).fill(62),
    ]);
    expect(await buildExtendedChangepointSignals("u1", NOW, {})).toEqual([]);
    only("RESTING_HEART_RATE", [
      ...Array<number>(60).fill(60),
      ...Array<number>(60).fill(64),
    ]);
    expect(await buildExtendedChangepointSignals("u1", NOW, {})).toHaveLength(
      1,
    );
  });

  it("reads a slow drift as a drift, not a dated shift", () => {
    // Resting heart rate creeping from 55 to 65 over 120 days, ±0.6 noise.
    const drift = Array.from({ length: 120 }, (_, i) => {
      const jitter = (((i * 7919) % 100) / 100 - 0.5) * 1.2;
      return 55 + (10 * i) / 119 + jitter;
    });
    expect(
      detectLevelShift(drift, { minAbsDelta: 3, spreadFloor: 1 }),
    ).toBeNull();
    // The same rise as a step does fire.
    const stepped = drift.map((_, i) => (i < 60 ? 55 : 65) + (i % 3) * 0.3);
    expect(
      detectLevelShift(stepped, { minAbsDelta: 3, spreadFloor: 1 }),
    ).not.toBeNull();
  });

  it("bounds the magnitude, so the flattest series cannot win the ranking", () => {
    const shift = detectLevelShift([
      ...Array<number>(30).fill(14),
      ...Array<number>(30).fill(17),
    ]);
    expect(shift?.magnitude).toBe(MAX_MAGNITUDE);
  });
});
