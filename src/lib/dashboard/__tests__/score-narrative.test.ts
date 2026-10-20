/**
 * v1.21.2 — unit pins for the score-card narrative resolver.
 *
 * The PROSE is not tested; the FLAGS the card renders are:
 *   - tension fires on a DISAGREEING readiness component set and carries the
 *     contributor KEYS partitioned onto the right side,
 *   - tension is SUPPRESSED (null) under the clinical-floors override (the
 *     coincident-deviation flag fired WITHOUT an illness explanation),
 *   - tension stays QUIET on a coherent component set,
 *   - returnToBand surfaces exactly ONE returned metric (the most salient) and
 *     omits when no salient metric returned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MeasurementType } from "@/generated/prisma/client";

const computeReadiness = vi.fn();
const computeCoincidentDeviation = vi.fn();
const readDayMeanSeries = vi.fn();

vi.mock("@/lib/insights/derived", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/insights/derived")>();
  return {
    ...actual,
    computeReadiness: (...a: unknown[]) => computeReadiness(...a),
    computeCoincidentDeviation: (...a: unknown[]) =>
      computeCoincidentDeviation(...a),
  };
});
vi.mock("@/lib/insights/derived/baseline", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/insights/derived/baseline")>();
  return {
    ...actual,
    readDayMeanSeries: (...a: unknown[]) => readDayMeanSeries(...a),
  };
});
vi.mock("@/lib/rollups/measurement-coverage", () => ({
  probeRollupCoverage: vi.fn(async () => new Map<string, boolean>()),
}));

import { buildScoreNarrativeBlock } from "@/lib/dashboard/score-narrative";

/** A readiness `ok` result with the given component values. */
function readiness(
  components: Array<{ key: string; value: number | null }>,
  band = "yellow",
) {
  return {
    status: "ok" as const,
    value: {
      score: 60,
      band,
      components: components.map((c) => ({ ...c, weight: 0.2 })),
    },
    confidence: { score: 80 },
    coverage: { historyDays: 30 },
  };
}

/** A coincident-deviation `ok` result. */
function coincident(fired: boolean, illnessExplained = false) {
  return {
    status: "ok" as const,
    value: {
      fired,
      contributing: [],
      day: "2026-06-27",
      illnessExplained,
    },
    confidence: { score: 80 },
    coverage: { historyDays: 30 },
  };
}

const PROFILE = { ageYears: 40, sex: "MALE" as const, heightCm: 180 };
const NOW = new Date("2026-06-27T08:00:00Z");
const COVERAGE = new Map<string, boolean>();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no metric series → no return-to-baseline.
  readDayMeanSeries.mockResolvedValue({ points: [], source: "none" });
  computeCoincidentDeviation.mockResolvedValue(coincident(false));
});

describe("buildScoreNarrativeBlock — tension (A5)", () => {
  it("fires on a disagreeing component set and partitions the keys", async () => {
    // sleep strongly favourable (>= 70), resting pulse strongly unfavourable
    // (<= 45) — a genuine internal disagreement.
    computeReadiness.mockResolvedValue(
      readiness(
        [
          { key: "sleep", value: 85 },
          { key: "rhr", value: 30 },
          { key: "hrv", value: 60 }, // neutral — neither side
        ],
        "yellow",
      ),
    );

    const block = await buildScoreNarrativeBlock(
      "u1",
      PROFILE,
      NOW,
      "Europe/Berlin",
      COVERAGE,
    );

    expect(block.tension).toEqual({
      band: "yellow",
      positive: ["sleep"],
      negative: ["rhr"],
    });
  });

  it("is suppressed under the clinical-floors override", async () => {
    computeReadiness.mockResolvedValue(
      readiness([
        { key: "sleep", value: 85 },
        { key: "rhr", value: 30 },
      ]),
    );
    // A real clinical red-flag: coincident-deviation fired WITHOUT an illness
    // explanation. The verdict must be suppressed so the red-flag dominates.
    computeCoincidentDeviation.mockResolvedValue(coincident(true, false));

    const block = await buildScoreNarrativeBlock(
      "u1",
      PROFILE,
      NOW,
      "Europe/Berlin",
      COVERAGE,
    );

    expect(block.tension).toBeNull();
  });

  it("does NOT suppress when the deviation is illness-explained", async () => {
    computeReadiness.mockResolvedValue(
      readiness([
        { key: "sleep", value: 85 },
        { key: "rhr", value: 30 },
      ]),
    );
    // Fired, but an illness episode explains it → not a clinical red-flag.
    computeCoincidentDeviation.mockResolvedValue(coincident(true, true));

    const block = await buildScoreNarrativeBlock(
      "u1",
      PROFILE,
      NOW,
      "Europe/Berlin",
      COVERAGE,
    );

    expect(block.tension).not.toBeNull();
    expect(block.tension?.positive).toContain("sleep");
    expect(block.tension?.negative).toContain("rhr");
  });

  it("stays quiet on a coherent component set", async () => {
    // All contributors favourable — nothing to reconcile.
    computeReadiness.mockResolvedValue(
      readiness([
        { key: "sleep", value: 85 },
        { key: "rhr", value: 80 },
        { key: "hrv", value: 75 },
      ]),
    );

    const block = await buildScoreNarrativeBlock(
      "u1",
      PROFILE,
      NOW,
      "Europe/Berlin",
      COVERAGE,
    );

    expect(block.tension).toBeNull();
  });
});

describe("buildScoreNarrativeBlock — returnToBand (A6)", () => {
  beforeEach(() => {
    // A coherent readiness so the tension branch contributes nothing.
    computeReadiness.mockResolvedValue(
      readiness([
        { key: "sleep", value: 80 },
        { key: "rhr", value: 80 },
      ]),
    );
  });

  /** A consecutive per-day-mean series starting 2026-06-01. */
  function series(values: number[]) {
    return {
      points: values.map((mean, i) => ({
        day: `2026-06-${String(1 + i).padStart(2, "0")}`,
        mean,
      })),
      source: "live" as const,
    };
  }

  it("surfaces exactly one returned metric", async () => {
    // RESTING_HEART_RATE: a prior out-of-band run (high), then back inside its
    // own personal band → a return-to-baseline event. Other types: flat in-band
    // (no return).
    readDayMeanSeries.mockImplementation(
      async (_u: string, type: MeasurementType) => {
        if (type === "RESTING_HEART_RATE") {
          // 8 days near 58, then 4 days spiking to ~80 (out high), then 4 days
          // back near 58 (returned). The MAD band is built over the whole
          // series; the recent return is the event.
          return series([
            58, 59, 57, 58, 60, 58, 59, 57, 80, 82, 81, 83, 58, 57, 59, 58,
          ]);
        }
        return { points: [], source: "none" as const };
      },
    );

    const block = await buildScoreNarrativeBlock(
      "u1",
      PROFILE,
      NOW,
      "Europe/Berlin",
      COVERAGE,
    );

    expect(block.returnToBand).not.toBeNull();
    expect(block.returnToBand?.metricType).toBe("RESTING_HEART_RATE");
    expect(block.returnToBand?.daysInside).toBeGreaterThanOrEqual(2);
  });

  it("omits when no salient metric returned", async () => {
    // Every type flat in-band → no prior out-of-band run, no return.
    readDayMeanSeries.mockResolvedValue(
      series([60, 61, 59, 60, 60, 61, 59, 60]),
    );

    const block = await buildScoreNarrativeBlock(
      "u1",
      PROFILE,
      NOW,
      "Europe/Berlin",
      COVERAGE,
    );

    expect(block.returnToBand).toBeNull();
  });
});
