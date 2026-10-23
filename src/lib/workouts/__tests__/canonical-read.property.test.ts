/**
 * The windowed read gives every surface the canonical workouts a read of the
 * whole history would give, whatever range it asked for.
 *
 * The store is an in-memory array behind the same bounded-read callback the
 * Prisma readers pass, so the property covers the reader's reach-back loop and
 * the range filter, not a copy of them.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { assertAsyncProperty } from "../../../../tests/property/fast-check";
import { pickCanonicalWorkoutRows } from "@/lib/measurements/pick-canonical-workout-rows";

import {
  canonicalClusterOf,
  canonicalWorkoutsInRange,
  readWorkoutsAroundRange,
  startsInRange,
  type WorkoutStartBounds,
  type WorkoutStartRange,
} from "../canonical-read";

type Source = "APPLE_HEALTH" | "WITHINGS" | "WHOOP" | "MANUAL";

interface Row {
  id: string;
  startedAt: Date;
  durationSec: number;
  sportType: string;
  source: Source;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  metadata: null;
}

const MIN = 60_000;
const BASE = Date.UTC(2026, 9, 1, 9, 0, 0);

function memoryStore(rows: readonly Row[]) {
  let reads = 0;
  const read = async (bounds: WorkoutStartBounds) => {
    reads += 1;
    return rows
      .filter(
        (row) =>
          (!bounds.gte || row.startedAt >= bounds.gte) &&
          (!bounds.lt || row.startedAt < bounds.lt),
      )
      .sort(
        (a, b) =>
          a.startedAt.getTime() - b.startedAt.getTime() ||
          a.id.localeCompare(b.id),
      );
  };
  return { read, reads: () => reads };
}

function sortedAll(rows: readonly Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id),
  );
}

/** What a read of the whole history says is canonical inside the range. */
function oracle(rows: readonly Row[], range: WorkoutStartRange): string[] {
  return pickCanonicalWorkoutRows(sortedAll(rows), null)
    .filter((row) => startsInRange(range, row.startedAt))
    .map((row) => row.id)
    .sort();
}

/**
 * Workouts packed tightly enough that chains of starts under five minutes
 * apart are common: the case where the cluster of a row depends on rows far
 * before it.
 */
const rowsArb = fc
  .array(
    fc.record({
      gapMin: fc.integer({ min: 0, max: 9 }),
      gapSec: fc.integer({ min: 0, max: 59 }),
      sportType: fc.constantFrom("running", "running", "cycling"),
      source: fc.constantFrom<Source>(
        "APPLE_HEALTH",
        "WITHINGS",
        "WHOOP",
        "MANUAL",
      ),
      durationMin: fc.integer({ min: 10, max: 60 }),
      hr: fc.option(fc.integer({ min: 90, max: 170 }), { nil: null }),
    }),
    { minLength: 1, maxLength: 40 },
  )
  .map((specs) => {
    let at = BASE;
    return specs.map((spec, index): Row => {
      at += spec.gapMin * MIN + spec.gapSec * 1000;
      return {
        id: `w${String(index).padStart(2, "0")}`,
        startedAt: new Date(at),
        durationSec: spec.durationMin * 60,
        sportType: spec.sportType,
        source: spec.source,
        avgHeartRate: spec.hr,
        maxHeartRate: null,
        metadata: null,
      };
    });
  });

const rangeArb = fc.record({
  fromOffsetMin: fc.option(fc.integer({ min: -10, max: 400 }), { nil: null }),
  lengthMin: fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }),
  inclusiveEnd: fc.boolean(),
});

function toRange(spec: {
  fromOffsetMin: number | null;
  lengthMin: number | null;
  inclusiveEnd: boolean;
}): WorkoutStartRange {
  const from =
    spec.fromOffsetMin === null
      ? null
      : new Date(BASE + spec.fromOffsetMin * MIN);
  const to =
    spec.lengthMin === null
      ? null
      : new Date((from?.getTime() ?? BASE) + spec.lengthMin * MIN);
  return { from, to, inclusiveEnd: spec.inclusiveEnd };
}

describe("readWorkoutsAroundRange", () => {
  it("resolves the range's canonical workouts as a whole-history read does", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(rowsArb, rangeArb, async (rows, rangeSpec) => {
        const range = toRange(rangeSpec);
        const store = memoryStore(rows);
        const windowed = await readWorkoutsAroundRange(range, store.read);
        const got = canonicalWorkoutsInRange(windowed, null)
          .map((row) => row.id)
          .sort();
        expect(got).toEqual(oracle(rows, range));
      }),
      300,
    );
  });

  it("gives one workout the same cluster whichever range found it", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(rowsArb, fc.nat(), async (rows, pick) => {
        const target = rows[pick % rows.length]!;
        const store = memoryStore(rows);
        const point = await readWorkoutsAroundRange(
          { from: target.startedAt, to: target.startedAt, inclusiveEnd: true },
          store.read,
        );
        const whole = await readWorkoutsAroundRange(
          { from: null, to: null },
          store.read,
        );
        const fromPoint = canonicalClusterOf(point, target.id, null);
        const fromWhole = canonicalClusterOf(whole, target.id, null);
        expect(fromPoint?.members.map((row) => row.id)).toEqual(
          fromWhole?.members.map((row) => row.id),
        );
        expect(fromPoint?.canonical[0]?.id).toBe(fromWhole?.canonical[0]?.id);
      }),
      300,
    );
  });

  it("depends on the history before the range, which the range alone does not show", async () => {
    // Three runs four minutes apart. Read from 09:55 the 09:58 run anchors a
    // cluster with 10:02, and 10:06 stands alone; read from 10:00 the 10:02
    // run anchors one with 10:06 and hides it behind the Apple row. The
    // windowed read reaches back to 09:58 and draws the clusters a
    // whole-history read draws.
    const at = (h: number, m: number) => new Date(Date.UTC(2026, 9, 1, h, m));
    const rows: Row[] = [
      ["a", at(9, 58), "WITHINGS"],
      ["b", at(10, 2), "APPLE_HEALTH"],
      ["c", at(10, 6), "WITHINGS"],
    ].map(([id, startedAt, source]) => ({
      id: id as string,
      startedAt: startedAt as Date,
      durationSec: 1800,
      sportType: "running",
      source: source as Source,
      avgHeartRate: null,
      maxHeartRate: null,
      metadata: null,
    }));
    const range = { from: at(10, 0), to: at(11, 0) };

    // The range read alone drops the 10:06 run as a twin of 10:02.
    const naive = pickCanonicalWorkoutRows(
      rows.filter((row) => startsInRange(range, row.startedAt)),
      null,
    ).map((row) => row.id);
    expect(naive).toEqual(["b"]);

    const windowed = await readWorkoutsAroundRange(
      range,
      memoryStore(rows).read,
    );
    expect(
      canonicalWorkoutsInRange(windowed, null).map((row) => row.id),
    ).toEqual(["b", "c"]);
    expect(oracle(rows, range)).toEqual(["b", "c"]);
  });

  it("leaves a workout's twins out of a baseline along with the workout", async () => {
    const at = (m: number) => new Date(BASE + m * MIN);
    const rows: Row[] = [
      { id: "old", startedAt: at(-600) },
      { id: "apple", startedAt: at(0) },
      { id: "withings", startedAt: at(1) },
    ].map((row, index) => ({
      ...row,
      durationSec: 1800,
      sportType: "running",
      source: index === 2 ? "WITHINGS" : "APPLE_HEALTH",
      avgHeartRate: null,
      maxHeartRate: null,
      metadata: null,
    }));
    const windowed = await readWorkoutsAroundRange(
      { from: at(-1000), to: null },
      memoryStore(rows).read,
    );
    expect(
      canonicalWorkoutsInRange(windowed, null, {
        excludeClusterOf: "withings",
      }).map((row) => row.id),
    ).toEqual(["old"]);
  });
});
