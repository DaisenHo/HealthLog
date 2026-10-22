import { describe, expect, it } from "vitest";

import { canonicalWorkoutTrimps } from "@/lib/workouts/canonical-read";

import {
  pickCanonicalWorkoutRows,
  workoutDuplicateClusterKeys,
  workoutSourceLadder,
} from "../pick-canonical-workout-rows";
import {
  legacyPickCanonicalWorkoutRows,
  legacyWorkoutDuplicateSlotKey,
} from "./pick-canonical-workout-rows.legacy";

type Source = "APPLE_HEALTH" | "WHOOP" | "WITHINGS" | "MANUAL" | "STRAVA";

interface Row {
  id: string;
  userId?: string;
  startedAt: Date;
  durationSec?: number;
  sportType: string;
  source: Source;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  metadata: Record<string, unknown> | null;
}

const MIN = 60_000;
const WINDOW = 5 * MIN;
const SOURCES: Source[] = [
  "APPLE_HEALTH",
  "WHOOP",
  "WITHINGS",
  "MANUAL",
  "STRAVA",
];
const SPORTS = ["running", "cycling", "walking"];

/** Small seeded generator, so a failure names a reproducible case. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!,
  };
}

function randomRows(seed: number): Row[] {
  const r = rng(seed);
  const base = Date.UTC(2026, 4, 16, 6, 0, 0) + r.int(0, 86_400_000);
  const count = r.int(1, 14);
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    // Mostly near each other, so clusters form; sometimes a re-send of an
    // earlier row (same start and duration) under another id.
    const twin = i > 0 && r.next() < 0.2 ? rows[r.int(0, i - 1)]! : null;
    const startedAt = twin
      ? new Date(
          twin.startedAt.getTime() + (r.next() < 0.5 ? 0 : r.int(1, 90) * 1000),
        )
      : new Date(base + r.int(0, 40 * MIN));
    rows.push({
      id: `w-${seed}-${i}`,
      userId: r.next() < 0.15 ? "other" : "u1",
      startedAt,
      durationSec:
        r.next() < 0.1 ? undefined : (twin?.durationSec ?? r.int(10, 90) * 60),
      sportType: twin && r.next() < 0.8 ? twin.sportType : r.pick(SPORTS),
      source: r.pick(SOURCES),
      avgHeartRate: r.next() < 0.5 ? r.int(100, 160) : null,
      maxHeartRate: r.next() < 0.5 ? r.int(160, 190) : null,
      metadata:
        r.next() < 0.3
          ? { zoneDurations: { zone_two_milli: r.int(1, 60) * MIN } }
          : null,
    });
  }
  // Callers pass `startedAt ASC, id ASC`.
  rows.sort(
    (a, b) =>
      a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id),
  );
  return rows;
}

/**
 * True when some pair of one (user, sport) lies within the window but in two
 * different fixed slots: the only inputs on which the old picker and the
 * duplicate window may disagree.
 */
function straddlesASlot(rows: readonly Row[]): boolean {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.userId !== b.userId || a.sportType !== b.sportType) continue;
      if (Math.abs(a.startedAt.getTime() - b.startedAt.getTime()) >= WINDOW)
        continue;
      if (legacyWorkoutDuplicateSlotKey(a) !== legacyWorkoutDuplicateSlotKey(b))
        return true;
    }
  }
  return false;
}

const LADDERS: unknown[] = [
  null,
  { steps: ["WITHINGS", "APPLE_HEALTH"] },
  { steps: ["WHOOP"] },
];

/** The strain fold as it stood on fixed slots, for the parity check. */
function legacyTrimps(
  rows: readonly Row[],
  ladderJson: unknown,
  trimpOf: (r: Row) => number,
) {
  const picked = new Set(
    legacyPickCanonicalWorkoutRows(rows, ladderJson).map((r) => r.id),
  );
  const ladder = workoutSourceLadder(ladderJson);
  const rankOf = (source: string) => {
    const index = ladder.indexOf(source as (typeof ladder)[number]);
    return index === -1 ? ladder.length : index;
  };
  const slots = new Map<
    string,
    { picked: Map<string, number>; dropped: number }
  >();
  for (const row of rows) {
    const key = legacyWorkoutDuplicateSlotKey(row);
    const slot = slots.get(key) ?? { picked: new Map(), dropped: 0 };
    const t = trimpOf(row);
    if (t > 0) {
      if (picked.has(row.id))
        slot.picked.set(row.source, (slot.picked.get(row.source) ?? 0) + t);
      else slot.dropped = Math.max(slot.dropped, t);
    }
    slots.set(key, slot);
  }
  const out: number[] = [];
  for (const slot of slots.values()) {
    let best: { rank: number; trimp: number } | null = null;
    for (const [source, trimp] of slot.picked) {
      const rank = rankOf(source);
      if (
        best === null ||
        rank < best.rank ||
        (rank === best.rank && trimp > best.trimp)
      ) {
        best = { rank, trimp };
      }
    }
    const trimp = best !== null ? best.trimp : slot.dropped;
    if (trimp > 0) out.push(trimp);
  }
  return out;
}

describe("workout duplicate window", () => {
  it("returns exactly the old rows wherever no pair straddles a slot boundary", () => {
    let compared = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const rows = randomRows(seed);
      if (straddlesASlot(rows)) continue;
      compared++;
      for (const ladder of LADDERS) {
        expect(pickCanonicalWorkoutRows(rows, ladder), `seed ${seed}`).toEqual(
          legacyPickCanonicalWorkoutRows(rows, ladder),
        );
      }
    }
    // The generator must actually produce comparable inputs, clusters
    // included, or the loop above proves nothing.
    expect(compared).toBeGreaterThan(1000);
  });

  it("gives the strain fold the same impulses wherever no pair straddles a slot", () => {
    const trimpOf = (row: Row) => row.avgHeartRate ?? 0;
    let compared = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const rows = randomRows(seed);
      if (straddlesASlot(rows)) continue;
      compared++;
      for (const ladder of LADDERS) {
        expect(
          canonicalWorkoutTrimps(rows, ladder, trimpOf),
          `seed ${seed}`,
        ).toEqual(legacyTrimps(rows, ladder, trimpOf));
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it("collapses two sources' copies of one session at any offset under five minutes", () => {
    const r = rng(7);
    let legacyMissed = 0;
    for (let i = 0; i < 3000; i++) {
      const start = Date.UTC(2026, 4, 16) + r.int(0, 86_400_000);
      const offset = r.int(0, WINDOW - 1);
      const rows: Row[] = [
        {
          id: "apple",
          userId: "u1",
          startedAt: new Date(start),
          durationSec: 1800,
          sportType: "running",
          source: "APPLE_HEALTH",
          avgHeartRate: null,
          maxHeartRate: null,
          metadata: null,
        },
        {
          id: "withings",
          userId: "u1",
          startedAt: new Date(start + offset),
          durationSec: 1790,
          sportType: "running",
          source: "WITHINGS",
          avgHeartRate: null,
          maxHeartRate: null,
          metadata: null,
        },
      ];
      expect(pickCanonicalWorkoutRows(rows).map((row) => row.id)).toEqual([
        "apple",
      ]);
      if (legacyPickCanonicalWorkoutRows(rows).length === 2) legacyMissed++;
    }
    // The fixed slots missed a share of these; the window misses none.
    expect(legacyMissed).toBeGreaterThan(0);
  });

  it("never collapses two workouts five minutes or more apart", () => {
    const r = rng(11);
    for (let i = 0; i < 2000; i++) {
      const start = Date.UTC(2026, 4, 16) + r.int(0, 86_400_000);
      const gap = WINDOW + r.int(0, 30 * MIN);
      const rows: Row[] = ["APPLE_HEALTH", "WITHINGS"].map((source, k) => ({
        id: `w${k}`,
        userId: "u1",
        startedAt: new Date(start + k * gap),
        durationSec: 1200,
        sportType: "running",
        source: source as Source,
        avgHeartRate: null,
        maxHeartRate: null,
        metadata: null,
      }));
      expect(pickCanonicalWorkoutRows(rows)).toHaveLength(2);
    }
  });

  it("does not depend on where the clock's five-minute marks fall", () => {
    // Shifting every start by the same amount keeps every gap, so it must
    // keep the picked set. The fixed slots broke this property.
    for (let seed = 1; seed <= 1500; seed++) {
      const rows = randomRows(seed);
      const shift = rng(seed * 31).int(1, WINDOW - 1);
      const shifted = rows.map((row) => ({
        ...row,
        startedAt: new Date(row.startedAt.getTime() + shift),
      }));
      const ids = (list: Row[]) => list.map((row) => row.id).sort();
      expect(ids(pickCanonicalWorkoutRows(shifted)), `seed ${seed}`).toEqual(
        ids(pickCanonicalWorkoutRows(rows)),
      );
    }
  });

  it("anchors on the first start, so a row of workouts does not chain", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 4, 16, 8, m, 0));
    const rows: Row[] = [0, 4, 8, 12].map((m, k) => ({
      id: `w${m}`,
      userId: "u1",
      startedAt: at(m),
      durationSec: 600,
      sportType: "running",
      source: (k % 2 === 0 ? "APPLE_HEALTH" : "WITHINGS") as Source,
      avgHeartRate: null,
      maxHeartRate: null,
      metadata: null,
    }));
    const keys = workoutDuplicateClusterKeys(rows);
    expect(new Set(keys).size).toBe(2);
    expect(pickCanonicalWorkoutRows(rows).map((row) => row.id)).toEqual([
      "w0",
      "w8",
    ]);
  });
});
