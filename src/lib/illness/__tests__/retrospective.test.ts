/**
 * v1.18.1 — illness retrospective summary aggregation.
 *
 * Asserts the count/byMonth/byType tallies, the CHRONIC_ONGOING gap exclusion,
 * and the v1.18.9 signal-density gates: the "typical recovery gap" is WITHHELD
 * unless enough episodes EACH clear the per-episode measurement floor AND the
 * resulting median magnitude is non-trivial (a 0/±1-day gap is coincidental
 * noise, not a finding).
 */
import { describe, expect, it } from "vitest";
import {
  summarizeIllnessRetrospective,
  MIN_EPISODES_FOR_TYPICAL_GAP,
  MIN_GAP_MEASUREMENT_DAYS,
  MIN_TYPICAL_GAP_MAGNITUDE_DAYS,
  type RetrospectiveEpisode,
} from "../retrospective";
import { computeIllnessCorrelation, type VitalDayPoint } from "../correlation";

/** A baseline with a non-zero, stable MAD (mirrors the correlation suite). */
function jitteredBaseline(
  center: number,
  jitter: number,
  days: number,
  endDay: string,
): VitalDayPoint[] {
  const out: VitalDayPoint[] = [];
  let cursor = Date.parse(`${endDay}T00:00:00Z`);
  const offsets = [-jitter, -jitter / 2, 0, jitter / 2, jitter];
  for (let i = 0; i < days; i++) {
    out.unshift({
      day: new Date(cursor).toISOString().slice(0, 10),
      mean: center,
    });
    cursor -= 24 * 60 * 60 * 1000;
  }
  return out.map((p, i) => ({
    ...p,
    mean: center + offsets[i % offsets.length],
  }));
}

function ep(over: Partial<RetrospectiveEpisode>): RetrospectiveEpisode {
  return {
    id: "e",
    type: "INFECTION",
    onsetDay: "2026-01-10",
    resolved: true,
    recoveryGapDays: 2,
    // Default to a well-covered episode so the gap-magnitude / sample-count
    // tests aren't masked by the per-episode measurement floor.
    gapMeasurementDays: MIN_GAP_MEASUREMENT_DAYS + 2,
    lifecycle: "ACUTE",
    ...over,
  };
}

describe("summarizeIllnessRetrospective", () => {
  it("counts episodes, resolved, by-month, by-type", () => {
    const out = summarizeIllnessRetrospective([
      ep({ id: "a", onsetDay: "2026-01-05", type: "INFECTION" }),
      ep({
        id: "b",
        onsetDay: "2026-11-20",
        type: "INFECTION",
        resolved: false,
        recoveryGapDays: null,
      }),
      ep({ id: "c", onsetDay: "2026-11-02", type: "ALLERGY" }),
    ]);
    expect(out.episodeCount).toBe(3);
    expect(out.resolvedCount).toBe(2);
    expect(out.byMonth[1]).toBe(1);
    expect(out.byMonth[11]).toBe(2);
    expect(out.byType.INFECTION).toBe(2);
    expect(out.byType.ALLERGY).toBe(1);
  });

  it("withholds the typical gap below the min-sample floor", () => {
    const out = summarizeIllnessRetrospective([
      ep({ id: "a", recoveryGapDays: 3 }),
      ep({ id: "b", recoveryGapDays: 5 }),
    ]);
    expect(MIN_EPISODES_FOR_TYPICAL_GAP).toBe(3);
    expect(out.gapSampleSize).toBe(2);
    expect(out.typicalRecoveryGapDays).toBeNull();
  });

  it("reports the median typical gap at/above the floor", () => {
    const out = summarizeIllnessRetrospective([
      ep({ id: "a", recoveryGapDays: 2 }),
      ep({ id: "b", recoveryGapDays: 4 }),
      ep({ id: "c", recoveryGapDays: 6 }),
    ]);
    expect(out.gapSampleSize).toBe(3);
    expect(out.typicalRecoveryGapDays).toBe(4);
  });

  it("excludes CHRONIC_ONGOING and null gaps from the median", () => {
    const out = summarizeIllnessRetrospective([
      ep({ id: "a", recoveryGapDays: 2 }),
      ep({ id: "b", recoveryGapDays: 4 }),
      ep({ id: "c", recoveryGapDays: 6 }),
      ep({ id: "d", recoveryGapDays: 100, lifecycle: "CHRONIC_ONGOING" }),
      ep({ id: "e", recoveryGapDays: null }),
    ]);
    expect(out.gapSampleSize).toBe(3);
    expect(out.typicalRecoveryGapDays).toBe(4);
  });

  it("drops episodes below the per-episode measurement floor", () => {
    // Three computed gaps, but only one episode is well-covered — the other
    // two ride on a couple of coincidental readings and must not count.
    const out = summarizeIllnessRetrospective([
      ep({ id: "a", recoveryGapDays: 4, gapMeasurementDays: 8 }),
      ep({
        id: "b",
        recoveryGapDays: 5,
        gapMeasurementDays: MIN_GAP_MEASUREMENT_DAYS - 1,
      }),
      ep({ id: "c", recoveryGapDays: 6, gapMeasurementDays: 0 }),
    ]);
    expect(out.gapSampleSize).toBe(1);
    expect(out.typicalRecoveryGapDays).toBeNull();
  });

  it("treats a missing gapMeasurementDays as non-qualifying", () => {
    const bare = (id: string): RetrospectiveEpisode => ({
      id,
      type: "INFECTION",
      onsetDay: "2026-01-10",
      resolved: true,
      recoveryGapDays: 4,
      lifecycle: "ACUTE",
    });
    const out = summarizeIllnessRetrospective([
      bare("a"),
      bare("b"),
      bare("c"),
    ]);
    expect(out.gapSampleSize).toBe(0);
    expect(out.typicalRecoveryGapDays).toBeNull();
  });

  it("withholds a trivial (sub-threshold) median gap as noise", () => {
    // Enough well-covered episodes, but the gaps cluster at 0/±1 — the
    // coincidental-data baseline. No speculative gap is surfaced.
    const out = summarizeIllnessRetrospective([
      ep({ id: "a", recoveryGapDays: 0 }),
      ep({ id: "b", recoveryGapDays: 1 }),
      ep({ id: "c", recoveryGapDays: -1 }),
    ]);
    expect(MIN_TYPICAL_GAP_MAGNITUDE_DAYS).toBe(2);
    expect(out.gapSampleSize).toBe(3); // they qualified on coverage…
    expect(out.typicalRecoveryGapDays).toBeNull(); // …but the magnitude is noise
  });

  it("names the dominant driving vital when a gap is surfaced", () => {
    const out = summarizeIllnessRetrospective([
      ep({
        id: "a",
        recoveryGapDays: 4,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
      ep({
        id: "b",
        recoveryGapDays: 6,
        gapReturnTypes: ["RESTING_HEART_RATE", "HEART_RATE_VARIABILITY"],
      }),
      ep({
        id: "c",
        recoveryGapDays: 5,
        gapReturnTypes: ["HEART_RATE_VARIABILITY"],
      }),
    ]);
    // RHR returned in 2 of 3 episodes, HRV in 2 as well — tie → deterministic
    // alphabetical resolution picks HEART_RATE_VARIABILITY.
    expect(out.typicalRecoveryGapDays).toBe(5);
    expect(out.gapDriverType).toBe("HEART_RATE_VARIABILITY");
  });

  it("picks the strictly-most-frequent driver", () => {
    const out = summarizeIllnessRetrospective([
      ep({
        id: "a",
        recoveryGapDays: 4,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
      ep({
        id: "b",
        recoveryGapDays: 6,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
      ep({
        id: "c",
        recoveryGapDays: 5,
        gapReturnTypes: ["HEART_RATE_VARIABILITY"],
      }),
    ]);
    expect(out.gapDriverType).toBe("RESTING_HEART_RATE");
  });

  it("leaves the driver null when no gap is surfaced", () => {
    const out = summarizeIllnessRetrospective([
      ep({
        id: "a",
        recoveryGapDays: 0,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
      ep({
        id: "b",
        recoveryGapDays: 1,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
      ep({
        id: "c",
        recoveryGapDays: -1,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
    ]);
    // Magnitude gate withholds the gap → no driver is named.
    expect(out.typicalRecoveryGapDays).toBeNull();
    expect(out.gapDriverType).toBeNull();
  });

  it("surfaces a negative gap once its magnitude clears the floor", () => {
    const out = summarizeIllnessRetrospective([
      ep({ id: "a", recoveryGapDays: -2 }),
      ep({ id: "b", recoveryGapDays: -3 }),
      ep({ id: "c", recoveryGapDays: -4 }),
    ]);
    expect(out.typicalRecoveryGapDays).toBe(-3);
  });

  it("threads the larger last-return gap through the cross-episode median", () => {
    // Integration guard for the relapse-aware (last-sustained) return change:
    // one episode relapses mid-course, so its ENGINE-computed gap grows from
    // the old first-return value (−1) to the last-return value (+6). The
    // retrospective consumes that engine number verbatim — confirm the larger
    // value pulls the cross-episode median up rather than the stale first
    // return. No retrospective code changes; this guards the integration.
    const baselineDays = jitteredBaseline(55, 1, 21, "2026-01-02");
    const relapseEpisode: VitalDayPoint[] = [
      { day: "2026-01-10", mean: 75 }, // first deviation
      { day: "2026-01-13", mean: 55 }, // first settle (old return)
      { day: "2026-01-14", mean: 55 },
      { day: "2026-01-15", mean: 55 }, // 3-day run
      { day: "2026-01-16", mean: 75 }, // RELAPSE
      { day: "2026-01-18", mean: 73 },
      { day: "2026-01-20", mean: 55 }, // final settle start
      { day: "2026-01-21", mean: 55 },
      { day: "2026-01-22", mean: 55 }, // holds to end
    ];
    const engine = computeIllnessCorrelation({
      episodeId: "relapse",
      window: {
        onsetDay: "2026-01-10",
        feltBetterDay: "2026-01-14",
        lifecycle: "ACUTE",
      },
      series: [
        {
          type: "RESTING_HEART_RATE",
          baselineDays,
          episodeDays: relapseEpisode,
        },
      ],
      source: "DAY",
      now: new Date("2026-02-01T00:00:00Z"),
    });
    expect(engine.status).toBe("ok");
    if (engine.status !== "ok") return;
    // Last-return = 01-20, gap = +6 (not the old first-return −1).
    expect(engine.value.recoveryGapDays).toBe(6);

    const out = summarizeIllnessRetrospective([
      ep({
        id: "relapse",
        recoveryGapDays: engine.value.recoveryGapDays,
        gapMeasurementDays: engine.coverage.historyDays,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
      ep({
        id: "b",
        recoveryGapDays: 4,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
      ep({
        id: "c",
        recoveryGapDays: 5,
        gapReturnTypes: ["RESTING_HEART_RATE"],
      }),
    ]);
    // Median of [6, 4, 5] = 5 — the relapse episode's grown gap is in the mix.
    expect(out.typicalRecoveryGapDays).toBe(5);
    expect(out.gapDriverType).toBe("RESTING_HEART_RATE");
  });
});
