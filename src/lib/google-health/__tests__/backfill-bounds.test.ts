/**
 * #1220 — a Google Health backfill is bounded by whether it gets anywhere and
 * by a horizon in years, not by a count of the pages it has read.
 *
 * The count (ten thousand pages per data type, across every slice) ran out
 * about two and a half years into a heart-rate history recorded every few
 * seconds, never reset, and left the backfill stopping at the same place on
 * every slice without ever being marked complete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, safeFetchMock } = vi.hoisted(() => ({
  prismaMock: { googleHealthConnection: { update: vi.fn() } },
  safeFetchMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-fetch")>()),
  safeFetch: safeFetchMock,
}));
vi.mock("@/lib/logging/context", () => ({
  annotate: () => {},
  getEvent: () => null,
}));

import {
  GOOGLE_HEALTH_NO_PROGRESS_PAGES,
  googleHealthBackfillHorizon,
  googleHealthBackfillHorizonYears,
  googleHealthWalkProgress,
  noteGoogleHealthWalkPage,
} from "../backfill-bounds";
import {
  googleHealthBackfillEndedList,
  googleHealthBackfillProgressAfterCompletion,
  readGoogleHealthBackfillEnded,
  recordGoogleHealthBackfillEnd,
  runGoogleHealthCollection,
  runWithGoogleHealthBackfillResume,
} from "../sync-core";
import {
  forEachDataPointPage,
  GOOGLE_HEALTH_DATA_TYPES,
  noteGoogleHealthDeferred,
  runWithGoogleHealthClientOutcome,
} from "../client";

const MINUTE = 60_000;
const T0 = Date.parse("2026-10-17T12:00:00Z");

/** A newest-first page of `size` readings, `offset` minutes back from T0. */
function descPage(offset: number, size = 1000): number[] {
  return Array.from({ length: size }, (_, i) => T0 - (offset + i) * MINUTE);
}

describe("the progress guard", () => {
  it("never stops a walk that reaches further back on every page", () => {
    // Fifty thousand pages: five times the old page count, still moving.
    const progress = googleHealthWalkProgress();
    for (let page = 0; page < 50_000; page++) {
      expect(noteGoogleHealthWalkPage(progress, descPage(page * 1000, 2))).toBe(
        false,
      );
    }
    expect(progress.stalled).toBe(0);
    expect(progress.order).toBe("desc");
  });

  it("stops a walk that keeps getting the same page", () => {
    const progress = googleHealthWalkProgress();
    const page = descPage(0, 50);
    expect(noteGoogleHealthWalkPage(progress, page)).toBe(false);
    for (let i = 1; i < GOOGLE_HEALTH_NO_PROGRESS_PAGES; i++) {
      expect(noteGoogleHealthWalkPage(progress, page)).toBe(false);
    }
    expect(noteGoogleHealthWalkPage(progress, page)).toBe(true);
  });

  it("starts over counting once a page reaches further again", () => {
    const progress = googleHealthWalkProgress();
    noteGoogleHealthWalkPage(progress, descPage(0, 10));
    for (let i = 0; i < GOOGLE_HEALTH_NO_PROGRESS_PAGES - 1; i++) {
      noteGoogleHealthWalkPage(progress, descPage(0, 10));
    }
    expect(noteGoogleHealthWalkPage(progress, descPage(10, 10))).toBe(false);
    expect(progress.stalled).toBe(0);
  });

  it("counts a cycle of pages it has already seen as no progress", () => {
    const progress = googleHealthWalkProgress();
    const pages = [descPage(0, 5), descPage(5, 5), descPage(10, 5)];
    for (const page of pages) noteGoogleHealthWalkPage(progress, page);
    let stopped = false;
    for (let i = 0; i < GOOGLE_HEALTH_NO_PROGRESS_PAGES && !stopped; i++) {
      stopped = noteGoogleHealthWalkPage(progress, pages[i % 3]!);
    }
    expect(stopped).toBe(true);
  });

  it("measures a walk resumed at an edge from the edge", () => {
    // Pages newer than the edge are what the walk already wrote.
    const edge = new Date(T0 - 5000 * MINUTE);
    const progress = googleHealthWalkProgress({ at: edge, order: "desc" });
    for (let i = 0; i < GOOGLE_HEALTH_NO_PROGRESS_PAGES - 1; i++) {
      expect(noteGoogleHealthWalkPage(progress, descPage(i * 10, 10))).toBe(
        false,
      );
    }
    expect(noteGoogleHealthWalkPage(progress, descPage(500, 10))).toBe(true);
  });

  it("counts a page without a readable time as no progress", () => {
    const progress = googleHealthWalkProgress();
    noteGoogleHealthWalkPage(progress, descPage(0, 3));
    for (let i = 0; i < GOOGLE_HEALTH_NO_PROGRESS_PAGES - 1; i++) {
      noteGoogleHealthWalkPage(progress, [null, null]);
    }
    expect(noteGoogleHealthWalkPage(progress, [])).toBe(true);
  });

  it("follows an oldest-first walk forward", () => {
    const progress = googleHealthWalkProgress();
    for (let page = 0; page < 100; page++) {
      const asc = Array.from(
        { length: 10 },
        (_, i) => T0 + (page * 10 + i) * MINUTE,
      );
      expect(noteGoogleHealthWalkPage(progress, asc)).toBe(false);
    }
    expect(progress.order).toBe("asc");
  });
});

describe("the walk under the progress guard", () => {
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const reading = (t: number) => ({
    heartRate: {
      beatsPerMinute: "60",
      sampleTime: { physicalTime: new Date(t).toISOString() },
    },
  });
  const walk = async (onPage: (n: number) => void = () => {}) => {
    const onNoProgress = vi.fn();
    const { outcome } = await runWithGoogleHealthClientOutcome(() =>
      forEachDataPointPage(
        GOOGLE_HEALTH_DATA_TYPES.heartRate,
        "token",
        "fetchHeartRate",
        { onNoProgress, maxPages: 10_000 },
        (points) => onPage(points.length),
      ),
    );
    return { outcome, onNoProgress };
  };

  beforeEach(() => {
    safeFetchMock.mockReset();
  });

  it("is not stopped by a long history that keeps moving", async () => {
    const pages = 3 * GOOGLE_HEALTH_NO_PROGRESS_PAGES;
    safeFetchMock.mockImplementation(async (url: string) => {
      const n = Number(new URL(url).searchParams.get("pageToken") ?? 0);
      return respond({
        dataPoints: [reading(T0 - n * MINUTE)],
        ...(n + 1 < pages ? { nextPageToken: String(n + 1) } : {}),
      });
    });
    const { outcome, onNoProgress } = await walk();
    expect(safeFetchMock).toHaveBeenCalledTimes(pages);
    expect(outcome.truncated).toBe(false);
    expect(onNoProgress).not.toHaveBeenCalled();
  });

  it("stops a walk that Google keeps answering with the same page", async () => {
    safeFetchMock.mockImplementation(async () =>
      respond({ dataPoints: [reading(T0)], nextPageToken: "again" }),
    );
    const written: number[] = [];
    const { outcome, onNoProgress } = await walk((n) => written.push(n));
    expect(safeFetchMock).toHaveBeenCalledTimes(
      1 + GOOGLE_HEALTH_NO_PROGRESS_PAGES,
    );
    // The page that tipped it over is not handed on.
    expect(written).toHaveLength(GOOGLE_HEALTH_NO_PROGRESS_PAGES);
    expect(outcome.truncated).toBe(true);
    expect(onNoProgress).toHaveBeenCalledTimes(1);
  });

  it("ends as complete, not truncated, when the caller says it has read enough", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      const n = Number(new URL(url).searchParams.get("pageToken") ?? 0);
      return respond({
        dataPoints: [reading(T0 - n * MINUTE)],
        nextPageToken: String(n + 1),
      });
    });
    let pages = 0;
    const { outcome } = await runWithGoogleHealthClientOutcome(() =>
      forEachDataPointPage(
        GOOGLE_HEALTH_DATA_TYPES.heartRate,
        "token",
        "fetchHeartRate",
        {},
        () => (++pages === 3 ? "end" : undefined),
      ),
    );
    expect(pages).toBe(3);
    expect(outcome.truncated).toBe(false);
  });
});

describe("the backfill horizon", () => {
  const saved = process.env.GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS;
  afterEach(() => {
    if (saved === undefined)
      delete process.env.GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS;
    else process.env.GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS = saved;
  });

  it("reads back twenty years unless the operator says otherwise", () => {
    delete process.env.GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS;
    expect(googleHealthBackfillHorizonYears()).toBe(20);
    expect(
      googleHealthBackfillHorizon(
        new Date("2026-10-17T12:00:00Z"),
      ).toISOString(),
    ).toBe("2006-10-17T12:00:00.000Z");
  });

  it("takes a whole number of years from 1 to 100", () => {
    process.env.GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS = "5";
    expect(googleHealthBackfillHorizonYears()).toBe(5);
    expect(
      googleHealthBackfillHorizon(
        new Date("2026-10-17T12:00:00Z"),
      ).toISOString(),
    ).toBe("2021-10-17T12:00:00.000Z");
    for (const bad of ["0", "101", "2.5", "-3", "ten", " "]) {
      process.env.GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS = bad;
      expect(googleHealthBackfillHorizonYears()).toBe(20);
    }
  });
});

describe("a collection ended short", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.googleHealthConnection.update.mockResolvedValue({});
  });

  const END = {
    type: "PULSE" as const,
    at: "2024-05-11T00:00:00.000Z",
    reason: "no_progress" as const,
  };

  it("counts as finished even though its walk ended truncated, and is noted with where and why", async () => {
    const done = new Set<string>();
    const { ended, collections } = await runWithGoogleHealthClientOutcome(() =>
      runWithGoogleHealthBackfillResume("u1", done, () =>
        runGoogleHealthCollection("fetchHeartRate", async () => {
          // The walk stopped for no progress: truncated, and the end noted.
          noteGoogleHealthDeferred();
          await recordGoogleHealthBackfillEnd("fetchHeartRate", END);
          return 0;
        }),
      ),
    ).then((r) => r.result);
    expect(collections).toEqual([
      expect.objectContaining({ key: "fetchHeartRate", status: "done" }),
    ]);
    expect([...ended]).toEqual([["fetchHeartRate", END]]);
    const written = prismaMock.googleHealthConnection.update.mock.calls.at(
      -1,
    )![0].data.backfillProgress as unknown;
    expect(
      readGoogleHealthBackfillEnded(written).get("fetchHeartRate"),
    ).toEqual(END);
  });

  it("is skipped by the next slice instead of walked into the same wall", async () => {
    const walk = vi.fn(async () => 1);
    const { skipped } = await runWithGoogleHealthBackfillResume(
      "u1",
      new Set(),
      () => runGoogleHealthCollection("fetchHeartRate", walk),
      new Map(),
      new Set(),
      new Map([["fetchHeartRate", END]]),
    );
    expect(walk).not.toHaveBeenCalled();
    expect(skipped).toEqual(["fetchHeartRate"]);
  });

  it("outlives the completion stamp, and nothing else does", () => {
    expect(googleHealthBackfillProgressAfterCompletion(new Map())).toBeNull();
    expect(
      googleHealthBackfillProgressAfterCompletion(
        new Map([["fetchHeartRate", END]]),
      ),
    ).toEqual({ ended: { fetchHeartRate: END } });
  });

  it("is published per type, and a malformed note is dropped", () => {
    expect(
      googleHealthBackfillEndedList({
        ended: {
          fetchHeartRate: END,
          fetchWeight: {
            type: "WEIGHT",
            at: "2006-10-17T12:00:00.000Z",
            reason: "horizon",
          },
          fetchBodyFat: { type: "BODY_FAT", at: "nope", reason: "horizon" },
          fetchSpo2: { type: "NOT_A_TYPE", at: END.at, reason: "horizon" },
          fetchHrv: { type: "PULSE", at: END.at, reason: "because" },
        },
      }),
    ).toEqual([
      { type: "PULSE", endsAt: END.at, reason: "no_progress" },
      {
        type: "WEIGHT",
        endsAt: "2006-10-17T12:00:00.000Z",
        reason: "horizon",
      },
    ]);
    expect(googleHealthBackfillEndedList(null)).toEqual([]);
  });
});
