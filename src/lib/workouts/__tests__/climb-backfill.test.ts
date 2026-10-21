import { describe, expect, it } from "vitest";

import {
  CLIMB_BACKFILL_DONE,
  runWorkoutClimbBackfill,
} from "../climb-backfill";

/**
 * An in-memory stand-in: workouts with an optional readable track (the
 * legacy column, which `readRouteGeometry` falls back to) and the cursor.
 */
function fake(
  workouts: Array<{
    id: string;
    elevationM: number | null;
    coords?: number[][];
  }>,
  cursor: string | null = null,
) {
  const state = { cursor, reads: 0 };
  const prisma = {
    appSettings: {
      findUnique: async () => ({ workoutClimbBackfillCursor: state.cursor }),
      upsert: async (args: {
        update: { workoutClimbBackfillCursor: string };
      }) => {
        state.cursor = args.update.workoutClimbBackfillCursor;
        return {};
      },
    },
    workout: {
      findMany: async (args: {
        where: { id?: { gt: string } };
        take: number;
      }) =>
        workouts
          .filter((w) => w.elevationM === null && w.coords)
          .filter((w) => !args.where.id || w.id > args.where.id.gt)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, args.take)
          .map((w) => ({ id: w.id })),
      updateMany: async (args: {
        where: { id: string };
        data: { elevationM: number };
      }) => {
        const w = workouts.find((x) => x.id === args.where.id)!;
        if (w.elevationM !== null) return { count: 0 };
        w.elevationM = args.data.elevationM;
        return { count: 1 };
      },
    },
    workoutRoute: {
      findUnique: async (args: { where: { workoutId: string } }) => {
        state.reads += 1;
        const w = workouts.find((x) => x.id === args.where.workoutId);
        return w?.coords
          ? {
              geometry: { type: "LineString", coordinates: w.coords },
              geometryEncrypted: null,
            }
          : null;
      },
    },
  };
  return { prisma: prisma as never, state, workouts };
}

describe("runWorkoutClimbBackfill", () => {
  it("fills the climb from the track and marks the pass done", async () => {
    const f = fake([
      {
        id: "a",
        elevationM: null,
        coords: [
          [8, 50, 100],
          [8, 50, 160],
          [8, 50, 140],
        ],
      },
      {
        id: "b",
        elevationM: 12,
        coords: [
          [8, 50, 0],
          [8, 50, 500],
        ],
      },
      {
        id: "c",
        elevationM: null,
        coords: [
          [8, 50],
          [8.1, 50.1],
        ],
      },
      { id: "d", elevationM: null },
    ]);
    const result = await runWorkoutClimbBackfill({
      prisma: f.prisma,
      pauseMs: 0,
    });
    expect(result).toEqual({ scanned: 2, filled: 1, done: true });
    expect(f.workouts.find((w) => w.id === "a")?.elevationM).toBe(60);
    // A stored elevation is never overwritten; no altitude stays NULL.
    expect(f.workouts.find((w) => w.id === "b")?.elevationM).toBe(12);
    expect(f.workouts.find((w) => w.id === "c")?.elevationM).toBeNull();
    expect(f.state.cursor).toBe(CLIMB_BACKFILL_DONE);
  });

  it("resumes after the cursor and never re-reads what it passed", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `w${String(i).padStart(4, "0")}`,
      elevationM: null as number | null,
      coords: [[8, 50]] as number[][],
    }));
    const f = fake(many);
    const first = await runWorkoutClimbBackfill({
      prisma: f.prisma,
      pauseMs: 0,
      maxBatches: 1,
    });
    expect(first).toEqual({ scanned: 100, filled: 0, done: false });
    expect(f.state.cursor).toBe("w0099");
    const rest = await runWorkoutClimbBackfill({
      prisma: f.prisma,
      pauseMs: 0,
    });
    expect(rest).toEqual({ scanned: 150, filled: 0, done: true });
    expect(f.state.reads).toBe(250);
    const again = await runWorkoutClimbBackfill({
      prisma: f.prisma,
      pauseMs: 0,
    });
    expect(again).toEqual({ scanned: 0, filled: 0, done: true });
    expect(f.state.reads).toBe(250);
  });
});
