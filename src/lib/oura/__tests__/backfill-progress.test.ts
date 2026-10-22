import { describe, expect, it } from "vitest";

import {
  ouraBackfillProgressJson,
  readOuraBackfillProgress,
  withoutDenied,
} from "../backfill-progress";
import { OURA_BACKFILL_ORDER } from "@/lib/jobs/oura-backfill";

describe("Oura backfill progress", () => {
  it("round-trips a note through the column", () => {
    const progress = {
      anchor: "2026-10-01",
      oldestSeen: "2024-03-02",
      historyStart: "2024-03-02",
      distanceRetired: true,
      collections: {
        activity: { before: "2015-01-01", done: true, windows: 47 },
        heartrate: { before: "2025-06-10", windows: 3 },
        workout: { before: "2026-10-01", denied: true },
      },
    };
    const json = ouraBackfillProgressJson(progress);
    expect(readOuraBackfillProgress(json, OURA_BACKFILL_ORDER)).toEqual(
      progress,
    );
  });

  it("keeps an empty history start apart from an unknown one", () => {
    const none = readOuraBackfillProgress(
      { anchor: "2026-10-01", historyStart: null, collections: {} },
      OURA_BACKFILL_ORDER,
    );
    expect(none?.historyStart).toBeNull();
    const unknown = readOuraBackfillProgress(
      { anchor: "2026-10-01", collections: {} },
      OURA_BACKFILL_ORDER,
    );
    expect(unknown).not.toHaveProperty("historyStart");
  });

  it("drops a malformed entry on its own and keeps the rest", () => {
    const read = readOuraBackfillProgress(
      {
        anchor: "2026-10-01",
        collections: {
          sleep: { before: "yesterday" },
          activity: { before: "2025-01-01" },
          not_a_collection: { before: "2025-01-01" },
        },
      },
      OURA_BACKFILL_ORDER,
    );
    expect(read?.collections).toEqual({ activity: { before: "2025-01-01" } });
  });

  it("reads no note at all without an anchor", () => {
    expect(readOuraBackfillProgress(null, OURA_BACKFILL_ORDER)).toBeNull();
    expect(
      readOuraBackfillProgress({ collections: {} }, OURA_BACKFILL_ORDER),
    ).toBeNull();
  });

  it("asks again for what a grant refused, and only that", () => {
    const cleared = withoutDenied({
      anchor: "2026-10-01",
      collections: {
        workout: { before: "2026-10-01", denied: true },
        activity: { before: "2015-01-01", done: true },
      },
    });
    expect(cleared.collections).toEqual({
      workout: { before: "2026-10-01" },
      activity: { before: "2015-01-01", done: true },
    });
  });

  it("walks the history probes first and heart rate last", () => {
    expect(OURA_BACKFILL_ORDER.slice(0, 2)).toEqual(["activity", "sleep"]);
    expect(OURA_BACKFILL_ORDER.at(-1)).toBe("heartrate");
    expect(new Set(OURA_BACKFILL_ORDER).size).toBe(OURA_BACKFILL_ORDER.length);
  });
});
