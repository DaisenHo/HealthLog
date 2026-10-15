import { afterEach, describe, expect, it } from "vitest";

import {
  combineHourCells,
  dayValue,
  dayValueRows,
  dayWeightedRows,
  foldMeanSql,
  hourWeightSql,
  isHourlyMeanTypeSql,
  readingsMean,
  storedHourWeightSql,
  weightedHourMeanSql,
  windowMeanSql,
  zoneDayFrame,
  SESSION_DAY_FRAME,
} from "../day-mean";
import {
  activePulseDayMeanMethod,
  hourWeight,
  isPulseDayMeanMethod,
  setActivePulseDayMeanMethod,
} from "../day-statistic";

const at = (iso: string) => new Date(iso);

/** One hard hour of 12 readings at 150 bpm, then three resting hours of one reading at 60. */
function workoutDay(day: string) {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    value: 150,
    measuredAt: at(`${day}T10:${String(i * 5).padStart(2, "0")}:00Z`),
  }));
  for (const h of ["12", "14", "16"]) {
    rows.push({ value: 60, measuredAt: at(`${day}T${h}:00:00Z`) });
  }
  return rows;
}

describe("dayValue", () => {
  it("is the mean of the hours' means for pulse", () => {
    expect(dayValue("PULSE", workoutDay("2026-03-02"), "UTC")).toBeCloseTo(
      (150 + 60 * 3) / 4,
      10,
    );
  });

  it("is the plain mean for every other type", () => {
    const rows = workoutDay("2026-03-02");
    expect(dayValue("HEART_RATE_VARIABILITY", rows, "UTC")).toBe(
      rows.reduce((s, r) => s + r.value, 0) / rows.length,
    );
  });

  it("is null without readings", () => {
    expect(dayValue("PULSE", [], "UTC")).toBeNull();
  });

  it("buckets hours on the zone's own half-hour boundaries", () => {
    // Asia/Kolkata is UTC+05:30: 10:20Z and 10:40Z are 15:50 and 16:10 local,
    // two different local hours, though one UTC hour.
    const rows = [
      { value: 100, measuredAt: at("2026-03-02T10:20:00Z") },
      { value: 100, measuredAt: at("2026-03-02T10:25:00Z") },
      { value: 40, measuredAt: at("2026-03-02T10:40:00Z") },
    ];
    expect(dayValue("PULSE", rows, "Asia/Kolkata")).toBe(70);
    expect(dayValue("PULSE", rows, "UTC")).toBe(80);
  });
});

describe("readingsMean", () => {
  it("weighs each local day once for pulse", () => {
    const rows = [
      ...workoutDay("2026-03-02"),
      { value: 60, measuredAt: at("2026-03-03T08:00:00Z") },
    ];
    expect(readingsMean("PULSE", rows, "UTC")).toBeCloseTo((82.5 + 60) / 2, 10);
  });

  it("splits days at the zone's midnight", () => {
    // 22:30Z is already the next day in Berlin (UTC+1 in March).
    const rows = [
      { value: 100, measuredAt: at("2026-03-02T10:00:00Z") },
      { value: 100, measuredAt: at("2026-03-02T11:00:00Z") },
      { value: 40, measuredAt: at("2026-03-02T23:30:00Z") },
    ];
    expect(readingsMean("PULSE", rows, "UTC")).toBe(80);
    expect(readingsMean("PULSE", rows, "Europe/Berlin")).toBe(70);
  });

  it("keeps the plain left-to-right mean for every other type", () => {
    const rows = [0.1, 0.2, 0.3].map((value, i) => ({
      value,
      measuredAt: at(`2026-03-0${i + 1}T08:00:00Z`),
    }));
    expect(readingsMean("WEIGHT", rows, "UTC")).toBe((0 + 0.1 + 0.2 + 0.3) / 3);
  });

  it("is null without readings", () => {
    expect(readingsMean("PULSE", [], "UTC")).toBeNull();
    expect(readingsMean("WEIGHT", [], "UTC")).toBeNull();
  });
});

describe("dayValueRows", () => {
  it("collapses pulse to one row per day", () => {
    const rows = workoutDay("2026-03-02");
    const days = dayValueRows("PULSE", rows, "UTC");
    expect(days).toHaveLength(1);
    expect(days[0].value).toBeCloseTo(82.5, 10);
    expect(days[0].measuredAt.toISOString()).toBe("2026-03-02T10:00:00.000Z");
  });

  it("hands every other type back untouched", () => {
    const rows = workoutDay("2026-03-02");
    expect(dayValueRows("BLOOD_GLUCOSE", rows, "UTC")).toBe(rows);
  });
});

/** One sparse hour (a single reading at 120), then 23 dense hours at 60. */
function sparseHourDay(day: string) {
  const rows = [{ value: 120, measuredAt: at(`${day}T00:30:00Z`) }];
  for (let h = 1; h < 24; h++) {
    for (let m = 0; m < 60; m += 10) {
      rows.push({
        value: 60,
        measuredAt: at(
          `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
        ),
      });
    }
  }
  return rows;
}

describe("pulse day-mean method", () => {
  afterEach(() => setActivePulseDayMeanMethod("hour_mean_v1"));

  it("weighs a lone reading's hour a third under weighted_hour_mean_v2", () => {
    const rows = sparseHourDay("2026-03-02");
    expect(dayValue("PULSE", rows, "UTC", "hour_mean_v1")).toBeCloseTo(
      62.5,
      10,
    );
    const v2 = dayValue("PULSE", rows, "UTC", "weighted_hour_mean_v2");
    expect(Number(v2!.toFixed(1))).toBe(60.9);
    expect(v2).toBeCloseTo((23 * 60 + 120 / 3) / (23 + 1 / 3), 10);
  });

  it("leaves a dense day where it was", () => {
    // Every hour holds at least three readings, so every hour weighs one.
    const dense = sparseHourDay("2026-03-02").slice(1);
    expect(dayValue("PULSE", dense, "UTC", "weighted_hour_mean_v2")).toBe(
      dayValue("PULSE", dense, "UTC", "hour_mean_v1"),
    );
  });

  it("follows the active method when the caller names none", () => {
    const rows = sparseHourDay("2026-03-02");
    expect(activePulseDayMeanMethod()).toBe("hour_mean_v1");
    expect(dayValue("PULSE", rows, "UTC")).toBeCloseTo(62.5, 10);
    setActivePulseDayMeanMethod("weighted_hour_mean_v2");
    expect(dayValue("PULSE", rows, "UTC")).toBeCloseTo(
      (23 * 60 + 40) / (23 + 1 / 3),
      10,
    );
    expect(readingsMean("PULSE", rows, "UTC")).toBeCloseTo(
      (23 * 60 + 40) / (23 + 1 / 3),
      10,
    );
    expect(dayValueRows("PULSE", rows, "UTC")[0].value).toBeCloseTo(
      (23 * 60 + 40) / (23 + 1 / 3),
      10,
    );
  });

  it("weighs hours by min(1, n / 3)", () => {
    expect([1, 2, 3, 10].map((n) => hourWeight(n, "weighted_hour_mean_v2")))
      .toEqual([1 / 3, 2 / 3, 1, 1]);
    expect([1, 2, 3].map((n) => hourWeight(n, "hour_mean_v1"))).toEqual([
      1, 1, 1,
    ]);
  });

  it("combines hour cells and skips empty ones", () => {
    const cells = [
      { sum: 120, n: 1 },
      { sum: 360, n: 6 },
      { sum: 0, n: 0 },
    ];
    expect(combineHourCells(cells, "hour_mean_v1")).toBe(90);
    expect(combineHourCells(cells, "weighted_hour_mean_v2")).toBeCloseTo(
      (40 + 60) / (4 / 3),
      10,
    );
    expect(combineHourCells([], "weighted_hour_mean_v2")).toBeNull();
  });

  it("recognises only the two stored values", () => {
    expect(isPulseDayMeanMethod("hour_mean_v1")).toBe(true);
    expect(isPulseDayMeanMethod("weighted_hour_mean_v2")).toBe(true);
    expect(isPulseDayMeanMethod("weighted")).toBe(false);
    expect(isPulseDayMeanMethod(null)).toBe(false);
  });
});

describe("SQL builders", () => {
  it("splice only the closed type list", () => {
    expect(isHourlyMeanTypeSql('m."type"')).toBe(
      `(m."type")::text IN ('PULSE')`,
    );
  });

  it("refuse a non-identifier source and an inline zone", () => {
    expect(() => dayWeightedRows("cm; DROP", SESSION_DAY_FRAME)).toThrow();
    expect(() => zoneDayFrame("'Europe/Berlin'")).toThrow();
    expect(zoneDayFrame("$3")).toEqual({ kind: "zone", tzSql: "$3" });
  });

  it("keep AVG for every other type and weigh pulse", () => {
    const sql = windowMeanSql({
      typeColumn: 'm."type"',
      value: 'm."value"',
      weight: "m.day_weight",
      filter: "m.x",
    });
    expect(sql).toContain('ELSE AVG(m."value") FILTER (WHERE m.x) END');
    expect(sql).toContain('SUM(m."value" * m.day_weight) FILTER (WHERE m.x)');
    const fold = foldMeanSql({
      typeColumn: 'c."type"',
      total: "c.total",
      count: "c.cnt",
      weightedSum: "c.wsum",
      weightSum: "c.wdays",
    });
    expect(fold).toContain("ELSE SUM(c.total) / SUM(c.cnt) END");
  });

  it("build the hour weight per method and refuse a non-column", () => {
    expect(hourWeightSql("h.n", "hour_mean_v1")).toBe("1.0");
    expect(hourWeightSql("h.n", "weighted_hour_mean_v2")).toBe(
      "LEAST(1.0, (h.n)::double precision / 3.0)",
    );
    expect(storedHourWeightSql("h.n")).toContain(
      `"pulse_day_mean_method" FROM "app_settings"`,
    );
    expect(weightedHourMeanSql("h.hour_mean", "1.0")).toBe(
      "(SUM((h.hour_mean) * 1.0) / NULLIF(SUM(1.0), 0))",
    );
    expect(() => hourWeightSql("n; DROP", "hour_mean_v1")).toThrow();
    expect(() => weightedHourMeanSql("x'", "1.0")).toThrow();
  });

  it("weigh the per-row day weight by the method", () => {
    const v1 = dayWeightedRows("cm", SESSION_DAY_FRAME, {
      method: "hour_mean_v1",
    });
    const v2 = dayWeightedRows("cm", SESSION_DAY_FRAME, {
      method: "weighted_hour_mean_v2",
    });
    expect(v1).not.toContain("LEAST");
    expect(v2).toContain("LEAST(1.0, (s.dm_hour_n)::double precision / 3.0)");
  });
});
