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
  CHANGEPOINT_WINDOW_DAYS,
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
