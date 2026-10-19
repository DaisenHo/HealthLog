import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * v1.4.37 W7c — GET /api/measurements gains two new branches for
 * cumulative HK types (steps, active energy, distance, flights,
 * daylight):
 *
 *   1. `?type=ACTIVITY_STEPS&groupBy=day` → one synthesised row per
 *      user-TZ day with `value` = SUM and `sampleCount` = number of
 *      per-sample rows behind the bucket.
 *   2. `?type=ACTIVITY_STEPS&dayKey=YYYY-MM-DD` → raw per-sample rows
 *      for that single calendar day in the user's IANA timezone.
 *
 * Spot metrics (BP, weight, pulse, etc.) keep the legacy
 * `findMany`-only behaviour even when these params are present —
 * the schema accepts the params but the route gates each branch on
 * `CUMULATIVE_HK_TYPES`.
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    measurement: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    measurementRollup: {
      findMany: vi.fn(),
    },
    // v1.29.6 — the groupBy=day branch now runs its raw rows through
    // `pickCanonicalSourceRows`, which loads the user's source-priority
    // blob via `loadUserSourcePriority` (prisma.user.findUnique). `null`
    // resolves to the default ladders.
    user: { findUnique: vi.fn() },
    // v1.4.43 W6 — validation-failed paths write an audit breadcrumb.
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));
vi.mock("@/lib/db-compat", () => ({
  ensureDbCompatibility: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

import { GET } from "../route";
import { auditLog } from "@/lib/auth/audit";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

const SESSION_OK = {
  session: { id: "sess-1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: {
    id: "user-1",
    username: "test-user",
    role: "USER" as const,
    timezone: "Europe/Berlin",
  },
};

function getRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/measurements?${query}`, {
    method: "GET",
  });
}

interface Group {
  day_key: string;
  source: string;
  device_type: string | null;
  unit: string;
  total: number;
  n: number;
}

/** One SQL fold row: a day's readings of one source, device and unit. */
function group(
  day_key: string,
  total: number,
  n: number,
  over: Partial<Group> = {},
): Group {
  return {
    day_key,
    source: "APPLE_HEALTH",
    device_type: null,
    unit: "steps",
    total,
    n,
    ...over,
  };
}

/**
 * The day-grouped branch answers from SQL alone: one query picks the page's
 * days, each row carrying the distinct-day total from a window count; a
 * second folds those days into source groups. A page past the end has no row
 * to carry the total, so only then is it counted on its own. Answer each
 * query by its text.
 */
function mockDayPage(
  days: string[],
  total = days.length,
  groups: Group[] = [],
) {
  vi.mocked(prisma.$queryRaw).mockImplementation(((
    strings: TemplateStringsArray,
  ) => {
    const text = strings.join("");
    if (text.includes("COUNT(DISTINCT")) return Promise.resolve([{ total }]);
    if (text.includes("COUNT(*) OVER ()")) {
      return Promise.resolve(days.map((day_key) => ({ day_key, total })));
    }
    if (text.includes("SUM(")) return Promise.resolve(groups);
    return Promise.resolve([]);
  }) as never);
}

/** The `$queryRaw` calls whose text contains `needle`. */
function rawCallsWith(needle: string) {
  return vi
    .mocked(prisma.$queryRaw)
    .mock.calls.filter(([strings]) =>
      (strings as unknown as string[]).join("").includes(needle),
    );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
  // v1.4.43 W6 — validation-failed paths fire a best-effort audit-row
  // write; the route swallows rejections so the test only needs a
  // resolved mock to keep the catch-block silent.
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  // v1.36.0 — the 422 breadcrumb writes through the `auditLog` helper, whose
  // returned promise the route attaches a `.catch` to.
  vi.mocked(auditLog).mockResolvedValue(undefined);
  // v1.29.6 — null source-priority blob → default rank ladders for the
  // groupBy=day canonical-source collapse.
  vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
});

describe("GET /api/measurements — groupBy=day (W7c collapsed list)", () => {
  it("collapses per-sample step rows into one row per user-TZ day with sampleCount", async () => {
    // Three Apple-Watch chunks on 2026-05-15 (Europe/Berlin) summing to 5400
    // and two on 2026-05-16 summing to 7000, as SQL folds them.
    mockDayPage(["2026-05-16", "2026-05-15"], 2, [
      group("2026-05-15", 5400, 3),
      group("2026-05-16", 7000, 2),
    ]);

    const res = await GET(
      getRequest(
        "type=ACTIVITY_STEPS&groupBy=day&from=2026-05-15T00:00:00Z&to=2026-05-17T00:00:00Z",
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        measurements: Array<{
          type: string;
          value: number;
          unit: string;
          dayKey: string;
          sampleCount: number;
          measuredAt: string;
        }>;
        meta: { groupBy?: string; total: number };
      };
    };
    expect(json.data.meta.groupBy).toBe("day");
    expect(json.data.measurements.length).toBe(2);
    // Sort is desc by default — newer day first.
    const [day16, day15] = json.data.measurements;
    expect(day16.dayKey).toBe("2026-05-16");
    expect(day16.value).toBe(7000);
    expect(day16.sampleCount).toBe(2);
    expect(day16.unit).toBe("steps");
    expect(day15.dayKey).toBe("2026-05-15");
    expect(day15.value).toBe(5400);
    expect(day15.sampleCount).toBe(3);
    // The collapsed row's measuredAt anchors to local noon so the
    // row sorts cleanly between same-day spot samples (canonical
    // daily-timestamp contract shared with the drain helper).
    expect(day15.measuredAt).toContain("2026-05-15T10:00:00");
  });

  // #1245 — the fold covers exactly the page's days: from the start of the
  // oldest page day to the end of the newest, in the user's zone, on top of
  // the request's own filters. Nothing outside the page is scanned, and no
  // raw row is read into the process at all.
  it("folds only the page's days, in SQL", async () => {
    mockDayPage(["2026-05-16", "2026-05-15"], 40);

    await GET(getRequest("type=ACTIVITY_STEPS&groupBy=day"));

    const [fold] = rawCallsWith("SUM(");
    const instants = (fold ?? [])
      .slice(1)
      .filter((v): v is Date => v instanceof Date)
      .map((d) => d.toISOString());
    // Europe/Berlin is UTC+2 in May.
    expect(instants).toEqual([
      "2026-05-14T22:00:00.000Z",
      "2026-05-16T22:00:00.000Z",
    ]);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });

  it("folds nothing when the page holds no day", async () => {
    mockDayPage([], 3);
    const res = await GET(
      getRequest("type=ACTIVITY_STEPS&groupBy=day&limit=25&offset=25"),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { measurements: unknown[]; meta: { total: number } };
    };
    expect(json.data.measurements).toEqual([]);
    expect(json.data.meta.total).toBe(3);
    expect(rawCallsWith("SUM(")).toHaveLength(0);
    // Past the end, and only there, the total is counted on its own.
    expect(rawCallsWith("COUNT(DISTINCT")).toHaveLength(1);
  });

  // v1.29.6 — a day with both an Apple Health AND a Withings write for the
  // same cumulative metric must collapse to the ladder-canonical source
  // before summing, exactly like the dashboard rollup tile
  // (`collapseRollupRowsBySource`) does. Without the collapse, 9000
  // Apple-Health steps + 8800 Withings steps summed to a fabricated 17800 —
  // a number the tile never showed.
  it("collapses cross-source rows to the ladder-canonical source before summing", async () => {
    mockDayPage(["2026-05-15"], 1, [
      group("2026-05-15", 8800, 1, { source: "WITHINGS" }),
      group("2026-05-15", 9000, 1),
    ]);

    const res = await GET(
      getRequest(
        "type=ACTIVITY_STEPS&groupBy=day&from=2026-05-15T00:00:00Z&to=2026-05-16T00:00:00Z",
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        measurements: Array<{
          dayKey: string;
          value: number;
          source: string;
          sampleCount: number;
        }>;
        meta: { droppedDuplicates?: number };
      };
    };
    expect(json.data.measurements.length).toBe(1);
    const [day] = json.data.measurements;
    // APPLE_HEALTH beats WITHINGS on the default `steps` ladder — the
    // Withings row drops out of the sum entirely rather than adding on top.
    expect(day.value).toBe(9000);
    expect(day.source).toBe("APPLE_HEALTH");
    expect(day.sampleCount).toBe(1);
    expect(json.data.meta.droppedDuplicates).toBe(1);
  });

  // #1245 — `limit` / `offset` page over days and reach the SQL that picks
  // them; `meta.total` is the distinct-day count, not the page length, and
  // no row is marked partial because every page day is read whole.
  it("pages over days and reports the distinct-day total", async () => {
    mockDayPage(["2026-04-20"], 40, [group("2026-04-20", 3400, 1)]);

    const res = await GET(
      getRequest("type=ACTIVITY_STEPS&groupBy=day&limit=25&offset=25"),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        measurements: Array<{ dayKey: string; partial?: boolean }>;
        meta: { total: number; limit: number; offset: number };
      };
    };
    expect(json.data.meta).toMatchObject({ total: 40, limit: 25, offset: 25 });
    expect(json.data.measurements.map((m) => m.dayKey)).toEqual(["2026-04-20"]);
    expect(json.data.measurements[0].partial).toBeUndefined();
    const [pageCall] = rawCallsWith("COUNT(*) OVER ()");
    expect(pageCall?.slice(1)).toEqual(expect.arrayContaining([25]));
    expect(pageCall?.slice(1).filter((v) => v === 25)).toHaveLength(2);
    // The total rode on the page's own rows; there was no second pass over
    // the history, only the fold of the page's one day.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(rawCallsWith("COUNT(DISTINCT")).toHaveLength(0);
  });

  // A device split inside the winning source keeps the top device's
  // groups only, the same narrowing the picker applies to raw rows.
  it("keeps the top-ranked device's groups within the winning source", async () => {
    mockDayPage(["2026-05-15"], 1, [
      group("2026-05-15", 6000, 40, { device_type: "watch" }),
      group("2026-05-15", 5500, 12, { device_type: "phone" }),
    ]);
    const res = await GET(getRequest("type=ACTIVITY_STEPS&groupBy=day"));
    const json = (await res.json()) as {
      data: {
        measurements: Array<{ value: number; sampleCount: number }>;
        meta: { droppedDuplicates: number };
      };
    };
    expect(json.data.measurements).toHaveLength(1);
    expect(json.data.measurements[0]).toMatchObject({
      value: 6000,
      sampleCount: 40,
    });
    expect(json.data.meta.droppedDuplicates).toBe(12);
  });

  it("falls back to the legacy findMany path when groupBy=day is set on a non-cumulative type", async () => {
    vi.mocked(prisma.measurement.findMany).mockResolvedValue([
      {
        id: "m-1",
        type: "PULSE",
        value: 60,
        unit: "bpm",
        source: "MANUAL",
        measuredAt: new Date("2026-05-15T09:00:00.000Z"),
        notes: null,
      },
    ] as never);
    vi.mocked(prisma.measurement.count).mockResolvedValue(1 as never);

    const res = await GET(getRequest("type=PULSE&groupBy=day"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        measurements: Array<{ type: string }>;
        meta: { groupBy?: string };
      };
    };
    // Spot metrics keep the per-sample shape; the collapse branch
    // never fires.
    expect(json.data.meta.groupBy).toBeUndefined();
    expect(json.data.measurements.length).toBe(1);
  });
});

describe("GET /api/measurements — dayKey drill-down (W7c)", () => {
  it("returns per-sample rows for the requested calendar day in the user's TZ", async () => {
    vi.mocked(prisma.measurement.findMany).mockResolvedValue([
      {
        id: "m-1",
        type: "ACTIVITY_STEPS",
        value: 1200,
        unit: "steps",
        source: "APPLE_HEALTH",
        measuredAt: new Date("2026-05-15T08:00:00.000Z"),
        notes: null,
      },
      {
        id: "m-2",
        type: "ACTIVITY_STEPS",
        value: 3400,
        unit: "steps",
        source: "APPLE_HEALTH",
        measuredAt: new Date("2026-05-15T15:00:00.000Z"),
        notes: null,
      },
    ] as never);

    const res = await GET(getRequest("type=ACTIVITY_STEPS&dayKey=2026-05-15"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        measurements: Array<{ id: string; value: number }>;
        meta: { dayKey?: string };
      };
    };
    expect(json.data.meta.dayKey).toBe("2026-05-15");
    expect(json.data.measurements.length).toBe(2);
    expect(json.data.measurements[0].value).toBe(1200);

    // The route resolves the user-TZ day boundary, so the underlying
    // findMany must be called with measuredAt: { gte, lt } shape.
    const call = vi.mocked(prisma.measurement.findMany).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    const measuredAt = (call as { where: { measuredAt?: unknown } }).where
      .measuredAt as { gte?: Date; lt?: Date };
    expect(measuredAt.gte).toBeInstanceOf(Date);
    expect(measuredAt.lt).toBeInstanceOf(Date);
    // Window is exactly 24 hours wide on a non-DST-transition day for
    // a whole-hour-offset zone. The DST-aware drill-down test below
    // pins the 23-/25-hour shape on the two transition days per year.
    expect(measuredAt.lt!.getTime() - measuredAt.gte!.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  // v1.4.37 W10 H-1 — DST awareness. The drill-down window must honour
  // the day's true local span (23 h on spring-forward, 25 h on
  // fall-back) so the row count matches what the collapsed daily row
  // displays. Previous shape (`canonicalDailyTimestamp ± 12h`) leaked
  // an hour from the previous day on spring-forward and hid the first
  // hour of `today` on fall-back.
  it("returns a 23-hour window on the Berlin spring-forward day (2025-03-30)", async () => {
    vi.mocked(prisma.measurement.findMany).mockResolvedValue([] as never);
    const res = await GET(getRequest("type=ACTIVITY_STEPS&dayKey=2025-03-30"));
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.measurement.findMany).mock.calls[0]?.[0];
    const measuredAt = (call as { where: { measuredAt?: unknown } }).where
      .measuredAt as { gte?: Date; lt?: Date };
    expect(measuredAt.gte!.toISOString()).toBe("2025-03-29T23:00:00.000Z");
    expect(measuredAt.lt!.toISOString()).toBe("2025-03-30T22:00:00.000Z");
    expect(measuredAt.lt!.getTime() - measuredAt.gte!.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it("returns a 25-hour window on the Berlin fall-back day (2025-10-26)", async () => {
    vi.mocked(prisma.measurement.findMany).mockResolvedValue([] as never);
    const res = await GET(getRequest("type=ACTIVITY_STEPS&dayKey=2025-10-26"));
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.measurement.findMany).mock.calls[0]?.[0];
    const measuredAt = (call as { where: { measuredAt?: unknown } }).where
      .measuredAt as { gte?: Date; lt?: Date };
    expect(measuredAt.gte!.toISOString()).toBe("2025-10-25T22:00:00.000Z");
    expect(measuredAt.lt!.toISOString()).toBe("2025-10-26T23:00:00.000Z");
    expect(measuredAt.lt!.getTime() - measuredAt.gte!.getTime()).toBe(
      25 * 60 * 60 * 1000,
    );
  });

  it("rejects a malformed dayKey at the validation gate (no DB call)", async () => {
    const res = await GET(getRequest("type=ACTIVITY_STEPS&dayKey=15.05.2026"));
    expect(res.status).toBe(422);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });

  it("ignores dayKey on non-cumulative types and falls back to the legacy path", async () => {
    vi.mocked(prisma.measurement.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.measurement.count).mockResolvedValue(0 as never);

    const res = await GET(getRequest("type=PULSE&dayKey=2026-05-15"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { meta: { dayKey?: string } };
    };
    // No dayKey echo on the legacy path — proves the W7c branch
    // didn't fire for the spot metric.
    expect(json.data.meta.dayKey).toBeUndefined();
  });
});

describe("GET /api/measurements — schema rejections (W10 reconcile)", () => {
  // #1245 — the day-grouped mode pages over days, so an offset is a real
  // page request now rather than a refused combination.
  it("accepts offset>0 when groupBy=day is set", async () => {
    mockDayPage([], 0);
    const res = await GET(
      getRequest("type=ACTIVITY_STEPS&groupBy=day&offset=25"),
    );
    expect(res.status).toBe(200);
  });

  // v1.4.37 W10 H1 — same restriction for the drill-down branch; it
  // returns a single bounded page per dayKey, not a cursor.
  it("rejects offset>0 when dayKey is set", async () => {
    const res = await GET(
      getRequest("type=ACTIVITY_STEPS&dayKey=2026-05-15&offset=25"),
    );
    expect(res.status).toBe(422);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });

  // v1.4.37 W10 H2 — `2026-02-30` is a YYYY-MM-DD string but not a
  // real calendar date. `new Date()` silently overflows it to March
  // 2, so the drill-down would point at the wrong day. The validator
  // refine must reject it at parse time.
  it("rejects impossible calendar dates on dayKey (2026-02-30)", async () => {
    const res = await GET(getRequest("type=ACTIVITY_STEPS&dayKey=2026-02-30"));
    expect(res.status).toBe(422);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });

  it("rejects impossible month on dayKey (2026-13-01)", async () => {
    const res = await GET(getRequest("type=ACTIVITY_STEPS&dayKey=2026-13-01"));
    expect(res.status).toBe(422);
    expect(prisma.measurement.findMany).not.toHaveBeenCalled();
  });
});
