/**
 * Intraday pulse shape + elevated-at-rest ("tension") detection.
 *
 * The signal-correctness bar for this slice is high (the launch posture is
 * "says less than it could"), so these pin the two things that are easy to get
 * embarrassingly wrong: the 10-minute bucketing (tz-correct day windows, sparse
 * data) and the tension gate refusing to flag a workout, a walk, or a short
 * spike — only a sustained, low-movement, above-baseline stretch fires.
 */
import { describe, it, expect } from "vitest";

import {
  BUCKET_MINUTES,
  ELEVATION_MARGIN_BPM,
  MIN_STEP_COVERAGE_BUCKETS,
  computeHourlyMeanSeries,
  computeTenMinuteMeanSeries,
  computeUploadedBucketSeries,
  detectTensionWindow,
  makeLocalResolver,
  partOfDayForMinute,
  type IntradayHrBucket,
  type IntradaySample,
  type DetectTensionInput,
} from "../intraday-pulse";

const utcOf = makeLocalResolver("UTC");

function sample(iso: string, value: number): IntradaySample {
  return { measuredAt: new Date(iso), value };
}

/** A dense low-movement step map with the required coverage, all zeros. */
function zeroSteps(...extraMinutes: number[]): Map<number, number> {
  const m = new Map<number, number>();
  // MIN_STEP_COVERAGE_BUCKETS distinct early-morning buckets + any extras.
  for (let i = 0; i < MIN_STEP_COVERAGE_BUCKETS; i++)
    m.set(i * BUCKET_MINUTES, 0);
  for (const min of extraMinutes) m.set(min, 0);
  return m;
}

/** A run of identical elevated buckets starting at `startMinute`. */
function elevatedRun(
  startMinute: number,
  count: number,
  mean = 80,
  sampleCount = 5,
): IntradayHrBucket[] {
  return Array.from({ length: count }, (_, i) => ({
    startMinute: startMinute + i * BUCKET_MINUTES,
    mean,
    count: sampleCount,
  }));
}

function tensionInput(
  over: Partial<DetectTensionInput> = {},
): DetectTensionInput {
  return {
    buckets: [],
    baseline: 60,
    baselineMature: true,
    stepBuckets: zeroSteps(),
    workouts: [],
    ...over,
  };
}

describe("computeTenMinuteMeanSeries", () => {
  it("means samples inside each 10-minute bucket and sorts ascending", () => {
    const series = computeTenMinuteMeanSeries(
      [
        sample("2026-05-01T10:00:00Z", 70),
        sample("2026-05-01T10:03:00Z", 80), // same bucket 600
        sample("2026-05-01T10:12:00Z", 90), // bucket 610
      ],
      "2026-05-01",
      utcOf,
    );
    expect(series).toEqual([
      { startMinute: 600, mean: 75, count: 2, min: 70, max: 80 },
      { startMinute: 610, mean: 90, count: 1, min: 90, max: 90 },
    ]);
  });

  it("keeps a lone-sample bucket (count reflects density for the gate)", () => {
    const series = computeTenMinuteMeanSeries(
      [sample("2026-05-01T08:05:00Z", 66)],
      "2026-05-01",
      utcOf,
    );
    expect(series).toEqual([
      { startMinute: 480, mean: 66, count: 1, min: 66, max: 66 },
    ]);
  });

  it("excludes samples from other local days (no next-day bleed)", () => {
    const series = computeTenMinuteMeanSeries(
      [
        sample("2026-05-01T23:55:00Z", 70), // stays on 05-01
        sample("2026-05-02T00:05:00Z", 90), // 05-02
      ],
      "2026-05-01",
      utcOf,
    );
    expect(series).toEqual([
      { startMinute: 1430, mean: 70, count: 1, min: 70, max: 70 },
    ]);
  });

  it("buckets on the USER's local day, not UTC (tz-correct windows)", () => {
    const nyOf = makeLocalResolver("America/New_York");
    // 02:30Z on 05-01 is 22:30 EDT on 04-30 → minute 1350, prior day.
    const s = [sample("2026-05-01T02:30:00Z", 72)];
    expect(computeTenMinuteMeanSeries(s, "2026-05-01", nyOf)).toEqual([]);
    expect(computeTenMinuteMeanSeries(s, "2026-04-30", nyOf)).toEqual([
      { startMinute: 1350, mean: 72, count: 1, min: 72, max: 72 },
    ]);
  });
});

describe("computeUploadedBucketSeries", () => {
  it("maps each bucket to its local 10-min slot with mean, synthetic count, and envelope", () => {
    const series = computeUploadedBucketSeries(
      [
        {
          bucketStart: new Date("2026-05-01T10:00:00.000Z"),
          mean: 72,
          min: 64,
          max: 88,
        },
        {
          bucketStart: new Date("2026-05-01T10:10:00.000Z"),
          mean: 75,
          min: 70,
          max: 81,
        },
      ],
      "2026-05-01",
      utcOf,
    );
    // count = MIN_SAMPLES_PER_BUCKET so a device-computed bucket passes the
    // tension density gate (a bucket already summarises many raw samples).
    expect(series).toEqual([
      { startMinute: 600, mean: 72, count: 2, min: 64, max: 88 },
      { startMinute: 610, mean: 75, count: 2, min: 70, max: 81 },
    ]);
  });

  it("omits min/max when the bucket carries no spread (avg-only upload)", () => {
    const series = computeUploadedBucketSeries(
      [
        {
          bucketStart: new Date("2026-05-01T08:20:00.000Z"),
          mean: 60,
          min: null,
          max: null,
        },
      ],
      "2026-05-01",
      utcOf,
    );
    expect(series).toEqual([{ startMinute: 500, mean: 60, count: 2 }]);
    expect(series[0]).not.toHaveProperty("min");
    expect(series[0]).not.toHaveProperty("max");
  });

  it("slots buckets by the UTC bucket-start in the user's local day, not UTC day", () => {
    const nyOf = makeLocalResolver("America/New_York");
    // 02:30Z on 05-01 = 22:30 EDT on 04-30 → local minute 1350, prior day.
    const buckets = [
      {
        bucketStart: new Date("2026-05-01T02:30:00.000Z"),
        mean: 55,
        min: 52,
        max: 60,
      },
    ];
    expect(computeUploadedBucketSeries(buckets, "2026-05-01", nyOf)).toEqual(
      [],
    );
    expect(computeUploadedBucketSeries(buckets, "2026-04-30", nyOf)).toEqual([
      { startMinute: 1350, mean: 55, count: 2, min: 52, max: 60 },
    ]);
  });
});

describe("computeHourlyMeanSeries", () => {
  it("means folded stats: rows landing in the same local hour", () => {
    const series = computeHourlyMeanSeries(
      [
        sample("2026-05-01T10:30:00Z", 70), // hour 10
        sample("2026-05-01T10:45:00Z", 80), // same hour 10 (defensive dup)
        sample("2026-05-01T14:30:00Z", 90), // hour 14
      ],
      "2026-05-01",
      utcOf,
    );
    expect(series).toEqual([
      { startMinute: 600, mean: 75, count: 2 },
      { startMinute: 840, mean: 90, count: 1 },
    ]);
  });

  it("excludes samples from other local days (no next-day bleed)", () => {
    const series = computeHourlyMeanSeries(
      [
        sample("2026-05-01T23:30:00Z", 70), // stays on 05-01, hour 23
        sample("2026-05-02T00:30:00Z", 90), // 05-02, hour 0
      ],
      "2026-05-01",
      utcOf,
    );
    expect(series).toEqual([{ startMinute: 1380, mean: 70, count: 1 }]);
  });

  it("buckets on the USER's local day, not UTC (tz-correct windows)", () => {
    const nyOf = makeLocalResolver("America/New_York");
    // 02:30Z on 05-01 is 22:30 EDT on 04-30 → hour 22, prior day.
    const s = [sample("2026-05-01T02:30:00Z", 72)];
    expect(computeHourlyMeanSeries(s, "2026-05-01", nyOf)).toEqual([]);
    expect(computeHourlyMeanSeries(s, "2026-04-30", nyOf)).toEqual([
      { startMinute: 1320, mean: 72, count: 1 },
    ]);
  });

  it("returns an empty series for a day with no folded rows", () => {
    expect(computeHourlyMeanSeries([], "2026-05-01", utcOf)).toEqual([]);
  });
});

describe("partOfDayForMinute", () => {
  it("labels the coarse part of day", () => {
    expect(partOfDayForMinute(5 * 60)).toBe("night");
    expect(partOfDayForMinute(9 * 60)).toBe("morning");
    expect(partOfDayForMinute(15 * 60)).toBe("afternoon");
    expect(partOfDayForMinute(20 * 60)).toBe("evening");
  });
});

describe("detectTensionWindow — fires only for sustained elevated-at-rest", () => {
  it("fires for a sustained above-baseline low-movement stretch", () => {
    const win = detectTensionWindow(
      tensionInput({ buckets: elevatedRun(600, 4) }),
    );
    expect(win).not.toBeNull();
    expect(win?.startMinute).toBe(600);
    expect(win?.endMinute).toBe(640);
    expect(win?.partOfDay).toBe("morning");
    expect(win?.meanHr).toBe(80);
    expect(win?.baseline).toBe(60);
  });

  it("does NOT flag a workout — high HR during exercise is not tension", () => {
    const win = detectTensionWindow(
      tensionInput({
        buckets: elevatedRun(600, 4),
        workouts: [{ startMinute: 595, endMinute: 645 }],
      }),
    );
    expect(win).toBeNull();
  });

  it("does NOT flag when steps are high — a walk is movement, not tension", () => {
    const win = detectTensionWindow(
      tensionInput({
        buckets: elevatedRun(600, 4),
        stepBuckets: new Map([
          ...zeroSteps(),
          [600, 200],
          [610, 210],
          [620, 190],
          [630, 220],
        ]),
      }),
    );
    expect(win).toBeNull();
  });

  it("does NOT flag heart rate that never clears the elevation margin", () => {
    const justUnder = 60 + ELEVATION_MARGIN_BPM - 1; // below threshold
    const win = detectTensionWindow(
      tensionInput({ buckets: elevatedRun(600, 4, justUnder) }),
    );
    expect(win).toBeNull();
  });

  it("does NOT flag a short spike below the sustained-minutes floor", () => {
    // Only two consecutive elevated buckets (20 min) — under the 30-min floor.
    const win = detectTensionWindow(
      tensionInput({ buckets: elevatedRun(600, 2) }),
    );
    expect(win).toBeNull();
  });

  it("breaks the run on a sparse (sub-density) bucket", () => {
    const buckets: IntradayHrBucket[] = [
      { startMinute: 600, mean: 80, count: 5 },
      { startMinute: 610, mean: 80, count: 1 }, // gap — filtered out
      { startMinute: 620, mean: 80, count: 5 },
      { startMinute: 630, mean: 80, count: 5 },
      { startMinute: 640, mean: 80, count: 5 },
    ];
    const win = detectTensionWindow(tensionInput({ buckets }));
    // 600 stands alone (next valid 620 is not adjacent); 620-640 is the run.
    expect(win?.startMinute).toBe(620);
    expect(win?.endMinute).toBe(650);
  });

  it("stays silent until the baseline is mature", () => {
    expect(
      detectTensionWindow(
        tensionInput({ buckets: elevatedRun(600, 4), baselineMature: false }),
      ),
    ).toBeNull();
  });

  it("stays silent with no baseline at all", () => {
    expect(
      detectTensionWindow(
        tensionInput({ buckets: elevatedRun(600, 4), baseline: null }),
      ),
    ).toBeNull();
  });

  it("stays silent without enough step coverage to trust low movement", () => {
    const win = detectTensionWindow(
      tensionInput({
        buckets: elevatedRun(600, 4),
        stepBuckets: new Map([
          [0, 0],
          [10, 0],
        ]), // below MIN_STEP_COVERAGE_BUCKETS
      }),
    );
    expect(win).toBeNull();
  });

  it("reports the longest qualifying run when several exist", () => {
    const buckets = [
      ...elevatedRun(120, 3), // 30 min
      { startMinute: 150, mean: 60, count: 5 }, // break
      ...elevatedRun(600, 5), // 50 min — the winner
    ];
    const win = detectTensionWindow(tensionInput({ buckets }));
    expect(win?.startMinute).toBe(600);
    expect(win?.endMinute).toBe(650);
  });

  it("marks hrvConfirmed when intraday HRV confirms within the window", () => {
    const win = detectTensionWindow(
      tensionInput({
        buckets: elevatedRun(600, 4),
        hrvConfirmMinutes: [610],
      }),
    );
    expect(win?.hrvConfirmed).toBe(true);
  });
});
