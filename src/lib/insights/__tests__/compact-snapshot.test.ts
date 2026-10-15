/**
 * #1217 — the status snapshots travel as compact JSON, and the char cap was
 * lowered with the switch so the model sees at least the same data for fewer
 * tokens, never less.
 *
 * Two properties pin that:
 *   1. compact JSON parses back to exactly the object the pretty form did, so
 *      dropping the indentation changes no content;
 *   2. every snapshot (and every shed stage of one) that fitted the old cap,
 *      24 000 pretty-printed characters, fits the new compact cap, so the
 *      shedding never starts earlier than it used to.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SNAPSHOT_CHARS,
  buildGradedSeriesFromPoints,
  degradeStatusSnapshotToBudget,
} from "@/lib/insights/graded-series";

/** The cap before v1.43, measured on `JSON.stringify(snapshot, null, 2)`. */
const PRETTY_CAP_BEFORE = 24_000;

const NOW = new Date("2026-10-15T12:00:00Z");

function series(days: number, perDay: number, base: number, seed: number) {
  const points: Array<{ measuredAt: Date; value: number }> = [];
  let x = seed;
  for (let d = 0; d < days; d++) {
    for (let k = 0; k < perDay; k++) {
      x = (x * 9301 + 49297) % 233280;
      points.push({
        measuredAt: new Date(NOW.getTime() - d * 86_400_000 - k * 3_600_000),
        value: Math.round((base + (x / 233280) * base * 0.2) * 10) / 10,
      });
    }
  }
  return buildGradedSeriesFromPoints(points, NOW, "Europe/Berlin");
}

/** A general-status-shaped snapshot over `metrics` series of `days` days. */
function snapshot(metrics: number, days: number): Record<string, unknown> {
  const measurementSeries: Record<string, unknown> = {};
  for (let i = 0; i < metrics; i++) {
    measurementSeries[`METRIC_${i}`] = {
      unit: i % 2 === 0 ? "bpm" : "kg",
      summary: { points: days * 2, mean: 61.2, min: 50, max: 80, latest: 63 },
      series: series(days, 2, 50 + i * 10, i + 1),
    };
  }
  return {
    locale: "de",
    generatedForDay: "2026-10-15",
    interpretationHint:
      "Use trend direction and deltas. Prioritize the newest data if trends conflict.",
    dataCoverage: {
      totalMeasurements: days * 2 * metrics,
      totalSpanDays: days,
      newestMeasurementDaysAgo: 0,
    },
    measurementSeries,
    correlations: Array.from({ length: 40 }, (_, i) => ({
      a: `METRIC_${i % metrics}`,
      b: `METRIC_${(i + 1) % metrics}`,
      r: Math.round(((i % 7) / 10 - 0.3) * 100) / 100,
      n: 30 + i,
    })),
  };
}

const FIXTURES: Array<[number, number]> = [];
for (const metrics of [1, 2, 3, 4, 6, 8, 10, 16]) {
  for (const days of [14, 30, 90, 200, 400, 1000]) {
    FIXTURES.push([metrics, days]);
  }
}

/** The shed stages `degradeStatusSnapshotToBudget` walks, in order. */
function stages(snap: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [structuredClone(snap)];
  const drop = (node: unknown, field: string): void => {
    if (Array.isArray(node)) return node.forEach((n) => drop(n, field));
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (key === field && Array.isArray(obj[key])) delete obj[key];
        else drop(obj[key], field);
      }
    }
  };
  const tails = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(tails);
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (Array.isArray(value) && key !== "recent" && value.length > 30) {
          obj[key] = value.slice(-30);
        }
        tails(obj[key]);
      }
    }
  };
  let current = structuredClone(snap);
  drop(current, "yearly");
  out.push(structuredClone(current));
  drop(current, "weekly");
  out.push(structuredClone(current));
  tails(current);
  out.push(structuredClone(current));
  current = structuredClone(current);
  drop(current, "recent");
  out.push(current);
  return out;
}

describe("compact status snapshots (#1217)", () => {
  it.each(FIXTURES)(
    "parses back to the same object (%i metrics, %i days)",
    (metrics, days) => {
      const snap = snapshot(metrics, days);
      const compact = JSON.stringify(snap);
      expect(JSON.parse(compact)).toEqual(
        JSON.parse(JSON.stringify(snap, null, 2)),
      );
      expect(compact.length).toBeLessThan(JSON.stringify(snap, null, 2).length);
    },
  );

  it("fits every stage that fitted the old pretty cap under the new compact cap", () => {
    let checked = 0;
    for (const [metrics, days] of FIXTURES) {
      for (const stage of stages(snapshot(metrics, days))) {
        if (JSON.stringify(stage, null, 2).length > PRETTY_CAP_BEFORE) continue;
        checked += 1;
        expect(JSON.stringify(stage).length).toBeLessThanOrEqual(
          MAX_SNAPSHOT_CHARS,
        );
      }
    }
    // The property is only worth something if it saw real cases near the cap.
    expect(checked).toBeGreaterThan(40);
  });

  it("sheds nothing from a snapshot that fitted before", () => {
    let fitted = 0;
    for (const [metrics, days] of FIXTURES) {
      const snap = snapshot(metrics, days);
      if (JSON.stringify(snap, null, 2).length > PRETTY_CAP_BEFORE) continue;
      fitted += 1;
      const before = structuredClone(snap);
      expect(degradeStatusSnapshotToBudget(snap)).toEqual([]);
      expect(snap).toEqual(before);
    }
    expect(fitted).toBeGreaterThan(5);
  });

  it("still sheds a snapshot far over the cap, coarsest-last", () => {
    const snap = snapshot(16, 1000);
    const size = JSON.stringify(snap).length;
    const shed = degradeStatusSnapshotToBudget(snap);
    expect(shed[0]).toBe("yearly");
    expect(JSON.stringify(snap).length).toBeLessThan(size);
  });
});
