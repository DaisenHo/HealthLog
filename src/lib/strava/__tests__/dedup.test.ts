import { describe, expect, it } from "vitest";

import {
  pickCanonicalWorkoutRows,
  workoutSourceLadder,
} from "@/lib/measurements/pick-canonical-workout-rows";
import { DEFAULT_SOURCE_PRIORITY } from "@/lib/validations/source-priority";

/**
 * v1.28.x — Strava rides the SAME source-agnostic workout dedup engine as every
 * other source: adding `STRAVA` to the ladders is all that is needed for an
 * Apple-Watch + Strava twin of one run to collapse to a single canonical row.
 * No Strava-specific dedup path exists (nor should it).
 */
const D = (iso: string) => new Date(iso);

describe("STRAVA workout dedup — read-time canonical picker", () => {
  it("collapses an Apple-Health + Strava twin of the same run to the device row", () => {
    const rows = [
      {
        startedAt: D("2026-07-01T06:30:00Z"),
        sportType: "running",
        source: "APPLE_HEALTH" as const,
      },
      // Same run, re-uploaded to Strava a minute later — same sport, same
      // 5-minute slot.
      {
        startedAt: D("2026-07-01T06:31:00Z"),
        sportType: "running",
        source: "STRAVA" as const,
      },
    ];
    const canonical = pickCanonicalWorkoutRows(rows);
    expect(canonical).toHaveLength(1);
    // The device-native capture outranks the Strava re-upload.
    expect(canonical[0].source).toBe("APPLE_HEALTH");
  });

  it("keeps a Strava-only run (no competing source) untouched", () => {
    const rows = [
      {
        startedAt: D("2026-07-02T18:00:00Z"),
        sportType: "cycling",
        source: "STRAVA" as const,
      },
    ];
    const canonical = pickCanonicalWorkoutRows(rows);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].source).toBe("STRAVA");
  });

  it("ranks STRAVA above MANUAL when both cover the same workout", () => {
    const rows = [
      {
        startedAt: D("2026-07-03T07:00:00Z"),
        sportType: "running",
        source: "MANUAL" as const,
      },
      {
        startedAt: D("2026-07-03T07:00:30Z"),
        sportType: "running",
        source: "STRAVA" as const,
      },
    ];
    const canonical = pickCanonicalWorkoutRows(rows);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].source).toBe("STRAVA");
  });
});

describe("STRAVA sits in the workout source ladders", () => {
  it("is present in the workout ladder, below the wearables, above MANUAL", () => {
    const strava = workoutSourceLadder(null).indexOf("STRAVA");
    const withings = workoutSourceLadder(null).indexOf("WITHINGS");
    const manual = workoutSourceLadder(null).indexOf("MANUAL");
    expect(strava).toBeGreaterThan(withings);
    expect(strava).toBeLessThan(manual);
  });

  it("is present in the `steps` ladder the read picker resolves against", () => {
    const steps = DEFAULT_SOURCE_PRIORITY.steps;
    const strava = steps.indexOf("STRAVA");
    const apple = steps.indexOf("APPLE_HEALTH");
    const manual = steps.indexOf("MANUAL");
    expect(strava).toBeGreaterThan(apple);
    expect(strava).toBeLessThan(manual);
  });
});
