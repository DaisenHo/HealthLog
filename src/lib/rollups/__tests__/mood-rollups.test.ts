/**
 * v1.4.39 — unit tests for the persistent mood-rollup
 * populator.
 *
 * `prisma` is mocked at the module level so we can pin:
 *   - the DAY-bucket sync recompute writes through the upsert path,
 *   - `recomputeMoodBucketsForEntry` is idempotent under re-run,
 *   - `enqueueMoodRollupRecompute` calls `boss.send` with the
 *     documented queue + singleton-key shape, and is a silent no-op
 *     when no boss is attached,
 *   - `ensureUserMoodRollupsFresh` short-circuits on fresh data and
 *     dedups concurrent callers onto one in-flight promise,
 *   - the boot-time backfill discovers users with mood entries but
 *     no rollup coverage and enqueues one job per uncovered user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories run BEFORE module-level statements due to hoisting,
// so the mock fns must live inside the factory closure. We re-export
// them through `vi.hoisted` so the test body can reach them after.
const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  queryRawUnsafe: vi.fn(),
  executeRaw: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findFirstMoodEntry: vi.fn(),
  bossSend: vi.fn(),
  getGlobalBossMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $queryRawUnsafe: mocks.queryRawUnsafe,
    $executeRaw: mocks.executeRaw,
    moodEntryRollup: {
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
    moodEntry: {
      findFirst: mocks.findFirstMoodEntry,
    },
  },
}));

vi.mock("@/lib/jobs/boss-instance", () => ({
  getGlobalBoss: () => mocks.getGlobalBossMock(),
}));

vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
}));

import { annotate } from "@/lib/logging/context";

const {
  queryRaw,
  queryRawUnsafe,
  executeRaw,
  upsert,
  deleteMany,
  findFirst,
  findFirstMoodEntry,
  bossSend,
  getGlobalBossMock,
} = mocks;
// `findMany` is wired in so indirect lookups don't throw; the
// populator tests below exercise the `$queryRawUnsafe` + upsert
// paths so the reference stays unused inside this file.
void mocks.findMany;
void queryRaw;

import {
  MOOD_ROLLUP_FULL_BACKFILL_QUEUE,
  MOOD_ROLLUP_RECOMPUTE_QUEUE,
  _resetEnsureUserMoodRollupsFreshInFlightForTests,
  enqueueBootTimeMoodRollupBackfill,
  enqueueMoodRollupRecompute,
  ensureUserMoodRollupsFresh,
  recomputeMoodBucketsForEntry,
  recomputeUserMoodRollups,
} from "../mood-rollups";
import { moodDateKey } from "@/lib/mood/date-key";

beforeEach(() => {
  queryRaw.mockReset();
  queryRawUnsafe.mockReset();
  executeRaw.mockReset();
  executeRaw.mockResolvedValue(0);
  upsert.mockReset();
  deleteMany.mockReset();
  findFirst.mockReset();
  mocks.findMany.mockReset();
  findFirstMoodEntry.mockReset();
  bossSend.mockReset();
  getGlobalBossMock.mockReset();
  // v1.4.39 — clear the per-userId in-flight map so a previous
  // test's resolved promise does not short-circuit the next test.
  _resetEnsureUserMoodRollupsFreshInFlightForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recomputeMoodBucketsForEntry", () => {
  function bindValues(call: unknown[]): unknown[] {
    return call.slice(1);
  }

  it("runs the atomic DAY upsert + DELETE pair and fires WEEK/MONTH/YEAR enqueues", async () => {
    // QA F-H-02 (v1.4.39): the DAY pass is now a single atomic SQL
    // statement (INSERT … SELECT … ON CONFLICT) plus a paired DELETE
    // that gates on NOT EXISTS. No JS-side aggregate, no per-row
    // upsert through the Prisma client.
    getGlobalBossMock.mockReturnValue({ send: bossSend });
    bossSend.mockResolvedValue("job-id");

    await recomputeMoodBucketsForEntry("user-1", "2026-05-10");

    expect(executeRaw).toHaveBeenCalledTimes(2);
    const insertBinds = bindValues(executeRaw.mock.calls[0]);
    expect(insertBinds).toContain("user-1");
    // v1.32.12 — the aggregate WHERE keys on the `date` label string,
    // and `bucket_start` is that label's UTC-midnight instant.
    expect(insertBinds).toContain("2026-05-10");
    const dayStart = new Date("2026-05-10T00:00:00.000Z");
    expect(
      (insertBinds.filter((b) => b instanceof Date) as Date[]).some(
        (d) => d.getTime() === dayStart.getTime(),
      ),
    ).toBe(true);

    // The enqueue is fire-and-forget; the response path
    // never awaits the boss.send call. Wait a tick for the
    // floating promise to flush before asserting.
    await new Promise((r) => setImmediate(r));

    expect(bossSend).toHaveBeenCalledTimes(3);
    for (const call of bossSend.mock.calls) {
      expect(call[0]).toBe(MOOD_ROLLUP_RECOMPUTE_QUEUE);
      expect(call[1].userId).toBe("user-1");
      expect(["WEEK", "MONTH", "YEAR"]).toContain(call[1].granularity);
    }
  });

  it("issues the paired DELETE so a fully-cleared day removes its row", async () => {
    getGlobalBossMock.mockReturnValue(null);

    await recomputeMoodBucketsForEntry("user-1", "2026-05-10");

    // The DELETE always fires; its NOT EXISTS predicate matches zero
    // rows on the populated-day branch and matches the row on the
    // emptied-day branch. We can only assert the second statement
    // fired here.
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("is idempotent under re-run for the same (user, day)", async () => {
    getGlobalBossMock.mockReturnValue(null);

    await recomputeMoodBucketsForEntry("user-1", "2026-05-10");
    await recomputeMoodBucketsForEntry("user-1", "2026-05-10");

    expect(executeRaw).toHaveBeenCalledTimes(4);
    // Bind values for the INSERT statement match across both runs.
    expect(bindValues(executeRaw.mock.calls[0])).toEqual(
      bindValues(executeRaw.mock.calls[2]),
    );
    // Bind values for the DELETE statement match across both runs.
    expect(bindValues(executeRaw.mock.calls[1])).toEqual(
      bindValues(executeRaw.mock.calls[3]),
    );
  });

  it("commits the strictest aggregate under concurrent recompute calls", async () => {
    // QA F-H-02 race pin: two concurrent recomputes for the same
    // (user, day) must both go through the atomic SQL path so each
    // statement re-aggregates a snapshot taken after the prior commit
    // released its row lock.
    getGlobalBossMock.mockReturnValue(null);

    await Promise.all([
      recomputeMoodBucketsForEntry("user-1", "2026-05-10"),
      recomputeMoodBucketsForEntry("user-1", "2026-05-10"),
    ]);
    // 2 callers × 2 statements (INSERT + DELETE) each.
    expect(executeRaw).toHaveBeenCalledTimes(4);
    // No legacy JS-side aggregate ($queryRawUnsafe) fired on the DAY
    // pass; no Prisma-API upsert / deleteMany were issued either.
    expect(queryRawUnsafe).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("does not await the WEEK/MONTH/YEAR enqueue on the write-path response", async () => {
    // QA F-H-03 (v1.4.39): the outer Promise.all is fire-and-forget so
    // a slow pg-boss send never serialises the user's mood-write
    // response. Pin that the helper resolves before the enqueue
    // promise settles.
    let resolveEnqueue: (() => void) | null = null;
    const enqueueGate = new Promise<string>((resolve) => {
      resolveEnqueue = () => resolve("job-late");
    });
    getGlobalBossMock.mockReturnValue({ send: () => enqueueGate });

    await recomputeMoodBucketsForEntry("user-1", "2026-05-10");

    // The helper has resolved even though the boss.send promise is
    // still pending. Resolve it after the assertion so the test does
    // not leak a pending promise across the suite.
    resolveEnqueue!();
    await enqueueGate;
  });
});

describe("mood rollup keying — canonical MoodEntry.date label (v1.32.12)", () => {
  // Each case is a boundary-straddling local mood. `moodDateKey` mints
  // the label the WRITE path stores in `MoodEntry.date` and every live
  // fallback keys on. The rollup writer must key its bucket on that SAME
  // label — the UTC truncation of `moodLoggedAt` (the old bug) lands the
  // entry on the wrong calendar day. All inputs are absolute instants +
  // named zones, so the assertions hold under TZ=UTC.
  const cases: Array<{
    name: string;
    moodLoggedAt: string;
    tz: string;
    expectedLabel: string;
    straddles: boolean;
  }> = [
    {
      name: "23:30 America/New_York straddles the UTC boundary forward",
      moodLoggedAt: "2026-05-11T03:30:00.000Z", // 23:30 EDT on 2026-05-10
      tz: "America/New_York",
      expectedLabel: "2026-05-10",
      straddles: true,
    },
    {
      name: "00:30 Europe/Berlin straddles the UTC boundary back",
      moodLoggedAt: "2026-05-09T22:30:00.000Z", // 00:30 CEST on 2026-05-10
      tz: "Europe/Berlin",
      expectedLabel: "2026-05-10",
      straddles: true,
    },
    {
      name: "legacy tz-null row anchors to Europe/Berlin",
      moodLoggedAt: "2026-05-09T22:30:00.000Z",
      tz: "",
      expectedLabel: "2026-05-10",
      straddles: true,
    },
    {
      name: "DST fall-back night (Europe/Berlin, 2025-10-26) straddles forward",
      moodLoggedAt: "2025-10-25T23:30:00.000Z", // 01:30 CEST on 2025-10-26
      tz: "Europe/Berlin",
      expectedLabel: "2025-10-26",
      straddles: true,
    },
  ];

  function utcLabel(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  it.each(cases)(
    "keys on the local date label, not the UTC day of moodLoggedAt — $name",
    async ({ moodLoggedAt, tz, expectedLabel, straddles }) => {
      getGlobalBossMock.mockReturnValue(null);
      const at = new Date(moodLoggedAt);

      // Parity: the label the write path stored (fallback key) is exactly
      // what the hook keys on.
      const label = moodDateKey(at, tz);
      expect(label).toBe(expectedLabel);

      await recomputeMoodBucketsForEntry("user-1", label);

      const insertBinds = executeRaw.mock.calls[0].slice(1);
      // Bucket keyed on the label string...
      expect(insertBinds).toContain(expectedLabel);
      // ...and bucket_start is that label's UTC midnight, which reads
      // back as exactly the stored label (byte-identical to the fallback).
      const bucketStart = insertBinds.find((b) => b instanceof Date) as Date;
      expect(bucketStart.toISOString()).toBe(`${expectedLabel}T00:00:00.000Z`);
      expect(utcLabel(bucketStart)).toBe(label);

      // The OLD (buggy) UTC-truncation of moodLoggedAt lands on a
      // different calendar day for every straddling entry.
      const buggyUtcDay = new Date(
        Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
      );
      expect(utcLabel(buggyUtcDay) !== expectedLabel).toBe(straddles);
      if (straddles) {
        expect(bucketStart.getTime()).not.toBe(buggyUtcDay.getTime());
      }
    },
  );
});

describe("runMoodRollupAggregate keys on the date label (v1.32.12)", () => {
  it('groups by m."date" (never mood_logged_at) and binds day labels', async () => {
    // Mutation guard: reverting the GROUP BY / WHERE back to
    // date_trunc(..., m."mood_logged_at") fails one of these assertions.
    getGlobalBossMock.mockReturnValue(null);
    queryRawUnsafe.mockResolvedValue([]);

    await recomputeUserMoodRollups("user-1", {
      granularities: ["DAY"],
      from: new Date("2021-05-10T00:00:00.000Z"),
      to: new Date("2026-05-10T12:00:00.000Z"),
    });

    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...binds] = queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain('m."date"');
    expect(sql).not.toContain("mood_logged_at");
    // Window bounds are lexicographic YYYY-MM-DD labels; the upper bound
    // rounds up past a mid-day `to` so today's label is still folded.
    expect(binds).toEqual(["user-1", "2021-05-10", "2026-05-11"]);
  });

  it("folds WEEK/MONTH/YEAR by the local label's calendar bucket", async () => {
    getGlobalBossMock.mockReturnValue(null);
    queryRawUnsafe.mockResolvedValue([]);

    await recomputeUserMoodRollups("user-1", {
      granularities: ["WEEK", "MONTH", "YEAR"],
      from: new Date("2026-05-04T00:00:00.000Z"),
      to: new Date("2026-05-11T00:00:00.000Z"),
    });

    for (const call of queryRawUnsafe.mock.calls) {
      const sql = call[0] as string;
      // The coarser tiers cast the label column to a date before
      // truncating — never touch mood_logged_at.
      expect(sql).toContain('m."date"::date');
      expect(sql).not.toContain("mood_logged_at");
    }
  });
});

describe("recomputeUserMoodRollups replace (delete-then-refold, v1.32.12)", () => {
  it("empties the folded granularities before refolding when replace:true", async () => {
    getGlobalBossMock.mockReturnValue(null);
    queryRawUnsafe.mockResolvedValue([]);
    deleteMany.mockResolvedValue({ count: 0 });

    await recomputeUserMoodRollups("user-1", {
      granularities: ["DAY", "WEEK"],
      replace: true,
    });

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", granularity: { in: ["DAY", "WEEK"] } },
    });
  });

  it("does NOT delete when replace is unset (per-bucket async fold)", async () => {
    getGlobalBossMock.mockReturnValue(null);
    queryRawUnsafe.mockResolvedValue([]);

    await recomputeUserMoodRollups("user-1", { granularities: ["WEEK"] });

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent — refolding twice upserts the identical bucket key + stats", async () => {
    getGlobalBossMock.mockReturnValue(null);
    deleteMany.mockResolvedValue({ count: 0 });
    const aggRow = {
      bucket_start: new Date("2026-05-10T00:00:00.000Z"),
      count: BigInt(3),
      mean: 4.2,
      min_score: 3,
      max_score: 5,
      sd: 0.5,
    };
    queryRawUnsafe.mockResolvedValue([aggRow]);
    upsert.mockResolvedValue({});

    await recomputeUserMoodRollups("user-1", {
      granularities: ["DAY"],
      replace: true,
    });
    const first = upsert.mock.calls.map((c) => c[0] as Record<string, unknown>);
    upsert.mockClear();
    await recomputeUserMoodRollups("user-1", {
      granularities: ["DAY"],
      replace: true,
    });
    const second = upsert.mock.calls.map(
      (c) => c[0] as Record<string, unknown>,
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // Same bucket key + same folded stats across both rebuilds (only the
    // computedAt wall-clock differs, which we don't compare).
    expect(first[0].where).toEqual(second[0].where);
    expect((first[0].create as { count: number }).count).toBe(
      (second[0].create as { count: number }).count,
    );
    expect((first[0].create as { mean: number }).mean).toBe(
      (second[0].create as { mean: number }).mean,
    );
  });
});

describe("enqueueMoodRollupRecompute", () => {
  it("is a silent no-op when no boss is attached", async () => {
    getGlobalBossMock.mockReturnValue(null);
    await enqueueMoodRollupRecompute({
      userId: "user-1",
      granularity: "WEEK",
      from: new Date("2026-05-04T00:00:00.000Z"),
      to: new Date("2026-05-11T00:00:00.000Z"),
    });
    expect(bossSend).not.toHaveBeenCalled();
  });

  it("sends with the documented queue + singleton-key shape", async () => {
    getGlobalBossMock.mockReturnValue({ send: bossSend });
    bossSend.mockResolvedValue("job-1");
    const from = new Date("2026-05-04T00:00:00.000Z");
    await enqueueMoodRollupRecompute({
      userId: "user-9",
      granularity: "WEEK",
      from,
      to: new Date("2026-05-11T00:00:00.000Z"),
    });
    expect(bossSend).toHaveBeenCalledTimes(1);
    const [queue, payload, opts] = bossSend.mock.calls[0];
    expect(queue).toBe(MOOD_ROLLUP_RECOMPUTE_QUEUE);
    expect(payload.userId).toBe("user-9");
    expect(payload.granularity).toBe("WEEK");
    expect(payload.from).toBe(from.toISOString());
    expect(opts.singletonKey).toBe(`user-9|WEEK|${from.toISOString()}`);
  });
});

describe("ensureUserMoodRollupsFresh", () => {
  it("is a no-op when the user has no mood entries", async () => {
    findFirst.mockResolvedValueOnce(null);
    findFirstMoodEntry.mockResolvedValueOnce(null);
    const result = await ensureUserMoodRollupsFresh("user-1");
    expect(result.recomputed).toBe(false);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("is a no-op when the rollup is already ahead of the newest mood entry", async () => {
    const rollupAt = new Date("2026-05-10T12:00:00.000Z");
    const entryAt = new Date("2026-05-10T11:00:00.000Z");
    findFirst.mockResolvedValueOnce({ computedAt: rollupAt });
    findFirstMoodEntry.mockResolvedValueOnce({
      updatedAt: entryAt,
      moodLoggedAt: entryAt,
    });
    const result = await ensureUserMoodRollupsFresh("user-1");
    expect(result.recomputed).toBe(false);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("triggers a DAY-window recompute when stale", async () => {
    const rollupAt = new Date("2026-05-10T10:00:00.000Z");
    const entryAt = new Date("2026-05-10T12:00:00.000Z");
    findFirst.mockResolvedValueOnce({ computedAt: rollupAt });
    findFirstMoodEntry.mockResolvedValueOnce({
      updatedAt: entryAt,
      moodLoggedAt: entryAt,
    });
    queryRawUnsafe.mockResolvedValueOnce([]);
    const result = await ensureUserMoodRollupsFresh("user-1");
    expect(result.recomputed).toBe(true);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("swallows populator errors so the read path never fails", async () => {
    findFirst.mockRejectedValueOnce(new Error("pool exhausted"));
    findFirstMoodEntry.mockRejectedValueOnce(new Error("pool exhausted"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ensureUserMoodRollupsFresh("user-1");
    expect(result.recomputed).toBe(false);
    consoleSpy.mockRestore();
  });

  it("dedups concurrent callers for the same userId onto one in-flight promise", async () => {
    const rollupAt = new Date("2026-05-10T10:00:00.000Z");
    const entryAt = new Date("2026-05-10T12:00:00.000Z");
    findFirst.mockResolvedValue({ computedAt: rollupAt });
    findFirstMoodEntry.mockResolvedValue({
      updatedAt: entryAt,
      moodLoggedAt: entryAt,
    });
    queryRawUnsafe.mockResolvedValue([]);

    const [a, b, c] = await Promise.all([
      ensureUserMoodRollupsFresh("user-1"),
      ensureUserMoodRollupsFresh("user-1"),
      ensureUserMoodRollupsFresh("user-1"),
    ]);
    expect(a.recomputed).toBe(true);
    expect(b.recomputed).toBe(true);
    expect(c.recomputed).toBe(true);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirstMoodEntry).toHaveBeenCalledTimes(1);
  });

  it("annotates the failure when the inner recompute throws", async () => {
    const rollupAt = new Date("2026-05-10T10:00:00.000Z");
    const entryAt = new Date("2026-05-10T12:00:00.000Z");
    findFirst.mockResolvedValueOnce({ computedAt: rollupAt });
    findFirstMoodEntry.mockResolvedValueOnce({
      updatedAt: entryAt,
      moodLoggedAt: entryAt,
    });
    queryRawUnsafe.mockRejectedValueOnce(new Error("deadlock detected"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await ensureUserMoodRollupsFresh("user-1");

    expect(result.recomputed).toBe(false);
    expect(annotate).toHaveBeenCalledWith({
      meta: {
        mood_rollup_refresh_failed: true,
        mood_rollup_refresh_error: "deadlock detected",
      },
    });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("enqueueBootTimeMoodRollupBackfill", () => {
  it("is a silent no-op when no boss is attached", async () => {
    getGlobalBossMock.mockReturnValue(null);
    const result = await enqueueBootTimeMoodRollupBackfill();
    expect(result).toEqual({ enqueued: 0, skipped: 0, error: null });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(bossSend).not.toHaveBeenCalled();
  });

  it("enqueues one full-fold job per user with mood entries but no rollups", async () => {
    getGlobalBossMock.mockReturnValue({ send: bossSend });
    queryRaw.mockResolvedValueOnce([
      { id: "user-a" },
      { id: "user-b" },
      { id: "user-c" },
    ]);
    bossSend
      .mockResolvedValueOnce("job-a")
      .mockResolvedValueOnce("job-b")
      .mockResolvedValueOnce("job-c");

    const result = await enqueueBootTimeMoodRollupBackfill();

    expect(result).toEqual({ enqueued: 3, skipped: 0, error: null });
    expect(bossSend).toHaveBeenCalledTimes(3);
    for (const call of bossSend.mock.calls) {
      expect(call[0]).toBe(MOOD_ROLLUP_FULL_BACKFILL_QUEUE);
    }
    expect(bossSend.mock.calls[0][2].singletonKey).toBe(
      "mood-boot-backfill|user-a",
    );
    expect(bossSend.mock.calls[1][2].singletonKey).toBe(
      "mood-boot-backfill|user-b",
    );
    expect(bossSend.mock.calls[2][2].singletonKey).toBe(
      "mood-boot-backfill|user-c",
    );
  });

  it("counts a `boss.send` returning null as 'skipped' (singleton coalesce)", async () => {
    getGlobalBossMock.mockReturnValue({ send: bossSend });
    queryRaw.mockResolvedValueOnce([{ id: "user-a" }, { id: "user-b" }]);
    bossSend.mockResolvedValueOnce(null).mockResolvedValueOnce("job-b");

    const result = await enqueueBootTimeMoodRollupBackfill();

    expect(result).toEqual({ enqueued: 1, skipped: 1, error: null });
  });

  it("returns the error message when the discovery query throws", async () => {
    getGlobalBossMock.mockReturnValue({ send: bossSend });
    queryRaw.mockRejectedValueOnce(new Error("pool exhausted"));

    const result = await enqueueBootTimeMoodRollupBackfill();

    expect(result.enqueued).toBe(0);
    expect(result.error).toBe("pool exhausted");
    expect(bossSend).not.toHaveBeenCalled();
  });

  it("returns { enqueued: 0 } when no users need backfill", async () => {
    getGlobalBossMock.mockReturnValue({ send: bossSend });
    queryRaw.mockResolvedValueOnce([]);

    const result = await enqueueBootTimeMoodRollupBackfill();

    expect(result).toEqual({ enqueued: 0, skipped: 0, error: null });
    expect(bossSend).not.toHaveBeenCalled();
  });
});
