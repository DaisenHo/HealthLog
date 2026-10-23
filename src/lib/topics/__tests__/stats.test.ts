import { describe, expect, it } from "vitest";

import { shiftDateKey } from "@/lib/tz/format";

import {
  RELATIONSHIP_MIN_PAIRED_DAYS,
  type TopicRelationshipDef,
} from "../registry";
import {
  computeRelationship,
  computeTrend,
  latestValue,
  pairDays,
  stateAgainstRange,
  usualRange,
  welchPValue,
  windowValues,
} from "../stats";

const TODAY = "2026-10-23";

/** `n` consecutive days ending today, valued by `f(i)` (i = 0 oldest). */
function series(n: number, f: (i: number) => number, end = TODAY) {
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    out.set(shiftDateKey(end, -(n - 1 - i)), f(i));
  }
  return out;
}

describe("windowValues / latestValue", () => {
  it("keeps the window's days in order and ignores a day after today", () => {
    const s = new Map([
      ["2026-10-20", 3],
      ["2026-10-18", 1],
      ["2026-10-24", 9],
    ]);
    expect(windowValues(s, "2026-10-18", TODAY).map((p) => p.day)).toEqual([
      "2026-10-18",
      "2026-10-20",
    ]);
    expect(latestValue(s, TODAY)).toEqual({ day: "2026-10-20", value: 3 });
    expect(latestValue(undefined, TODAY)).toBeNull();
  });
});

describe("usualRange", () => {
  it("says nothing below a week of days", () => {
    expect(
      usualRange(
        "PULSE",
        series(6, () => 60),
        TODAY,
      ),
    ).toBeNull();
  });

  it("builds the personal band from a week or more", () => {
    const band = usualRange(
      "RESTING_HEART_RATE",
      series(30, (i) => 58 + (i % 3)),
      TODAY,
    );
    expect(band).not.toBeNull();
    expect(band!.days).toBe(30);
    expect(band!.low).toBeLessThanOrEqual(58);
    expect(band!.high).toBeGreaterThanOrEqual(60);
  });

  it("reads only the trailing 90 days", () => {
    const old = series(30, () => 100, shiftDateKey(TODAY, -200));
    expect(usualRange("WEIGHT", old, TODAY)).toBeNull();
  });
});

describe("stateAgainstRange", () => {
  const band = { low: 55, high: 62, center: 58, days: 30 };
  it("places a value against the band, and says when it cannot", () => {
    expect(stateAgainstRange(null, band)).toBe("none");
    expect(stateAgainstRange({ day: TODAY, value: 60 }, null)).toBe("learning");
    expect(stateAgainstRange({ day: TODAY, value: 60 }, band)).toBe("within");
    expect(stateAgainstRange({ day: TODAY, value: 70 }, band)).toBe("above");
    expect(stateAgainstRange({ day: TODAY, value: 50 }, band)).toBe("below");
  });
});

describe("computeTrend", () => {
  it("draws no slope through fewer than 14 days", () => {
    const trend = computeTrend(
      "WEIGHT",
      series(10, (i) => 80 - i),
      TODAY,
    );
    expect(trend.status).toBe("insufficient");
    expect(trend.change).toBeNull();
    expect(trend.days).toBe(10);
  });

  it("reports the fitted change across the window", () => {
    // One kilogram down every ten days, for ninety days.
    const trend = computeTrend(
      "WEIGHT",
      series(90, (i) => 85 - i / 10),
      TODAY,
    );
    expect(trend.status).toBe("ok");
    expect(trend.change).toBeCloseTo(-8.9, 1);
    expect(trend.weekly.length).toBeGreaterThanOrEqual(13);
    expect(trend.weekly[0].value).toBeGreaterThan(trend.weekly.at(-1)!.value);
  });
});

describe("pairDays", () => {
  it("holds x on day d against y on day d + lag, inside the window", () => {
    const x = series(5, (i) => i);
    const y = series(5, (i) => 10 + i);
    const sameDay = pairDays(x, y, 0, shiftDateKey(TODAY, -4), TODAY);
    expect(sameDay).toHaveLength(5);
    const nextDay = pairDays(x, y, 1, shiftDateKey(TODAY, -4), TODAY);
    expect(nextDay).toHaveLength(4);
    expect(nextDay[0]).toMatchObject({ x: 0, y: 11 });
  });
});

describe("computeRelationship", () => {
  const corr: TopicRelationshipDef = {
    id: "a-b",
    x: "HEART_RATE_VARIABILITY",
    y: "RESTING_HEART_RATE",
    lagDays: 0,
    kind: "correlation",
  };
  const from = shiftDateKey(TODAY, -89);

  it("says nothing but the count below 14 paired days", () => {
    const n = RELATIONSHIP_MIN_PAIRED_DAYS - 1;
    const rel = computeRelationship(
      corr,
      series(n, (i) => 50 + i),
      series(n, (i) => 70 - i),
      from,
      TODAY,
    );
    expect(rel.status).toBe("insufficient");
    expect(rel.pairedDays).toBe(n);
    expect(rel.requiredDays).toBe(14);
    expect(rel.r).toBeNull();
    expect(rel.points).toEqual([]);
  });

  it("reports a clear negative link with its r and its days", () => {
    const rel = computeRelationship(
      corr,
      series(30, (i) => 50 + i),
      series(30, (i) => 70 - i + (i % 2) * 0.5),
      from,
      TODAY,
    );
    expect(rel.status).toBe("linked");
    expect(rel.r).toBeLessThan(-0.9);
    expect(rel.pairedDays).toBe(30);
    expect(rel.points).toHaveLength(30);
  });

  it("calls an unrelated pair what it is", () => {
    const noise = [3, 9, 1, 7, 5, 2, 8, 4, 6, 0, 9, 2, 7, 1, 5, 8, 3, 6, 0, 4];
    const rel = computeRelationship(
      corr,
      series(20, (i) => i),
      series(20, (i) => noise[i]),
      from,
      TODAY,
    );
    expect(rel.status).toBe("no_clear_link");
    expect(rel.pairedDays).toBe(20);
  });

  it("compares the days below a threshold with the others", () => {
    const split: TopicRelationshipDef = {
      id: "short-nights",
      x: "SLEEP_DURATION",
      y: "RESTING_HEART_RATE",
      lagDays: 0,
      kind: "split",
      threshold: 420,
    };
    const sleep = series(28, (i) => (i % 4 === 0 ? 360 : 480));
    const rhr = series(28, (i) => (i % 4 === 0 ? 63 : 58) + (i % 3) * 0.2);
    const rel = computeRelationship(split, sleep, rhr, from, TODAY);
    expect(rel.status).toBe("linked");
    expect(rel.split).toMatchObject({ belowDays: 7, otherDays: 21 });
    expect(rel.split!.difference).toBeGreaterThan(4);
  });

  it("will not compare a split whose one side is too thin", () => {
    const split: TopicRelationshipDef = {
      id: "short-nights",
      x: "SLEEP_DURATION",
      y: "MOOD",
      lagDays: 0,
      kind: "split",
      threshold: 420,
    };
    const sleep = series(20, (i) => (i < 2 ? 360 : 480));
    const rel = computeRelationship(
      split,
      sleep,
      series(20, () => 3),
      from,
      TODAY,
    );
    expect(rel.status).toBe("insufficient");
    expect(rel.pairedDays).toBe(20);
  });
});

describe("welchPValue", () => {
  it("is 1 for identical groups and small for well separated ones", () => {
    expect(welchPValue([1, 1, 1], [1, 1, 1])).toBe(1);
    expect(welchPValue([1, 2, 1, 2, 1], [9, 8, 9, 8, 9])).toBeLessThan(0.001);
  });
});
