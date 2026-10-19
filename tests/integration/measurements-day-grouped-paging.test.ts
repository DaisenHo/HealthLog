/**
 * #1245 — `GET /api/measurements?type=<cumulative>&groupBy=day` pages over
 * local days.
 *
 * The list used to read the newest `limit` raw rows (the web asked for 5000),
 * fold them into days and return every day at once: thousands of table rows
 * for a long history, and every day older than the 5000th raw row silently
 * missing. The history seeded here is longer than that old cap on purpose,
 * with gap days and a second source on some days, and the test walks every
 * page to prove each day arrives exactly once, whole, on a small first page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { cookieJar, headerJar } from "./mock-next-headers";
import { getPrismaClient, truncateAllTables } from "./setup";

vi.mock("next/headers", async () => {
  const { cookieJar, headerJar } = await import("./mock-next-headers");
  return {
    headers: vi.fn(async () => ({
      get: (name: string) => headerJar.get(name.toLowerCase()) ?? null,
    })),
    cookies: vi.fn(async () => ({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value ? { name, value } : undefined;
      },
      set: (name: string, value: string) => cookieJar.set(name, value),
      delete: (name: string) => cookieJar.delete(name),
    })),
  };
});

vi.mock("@/lib/db-compat", () => ({
  ensureDbCompatibility: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
  cookieJar.clear();
  headerJar.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface DayRow {
  id: string;
  dayKey: string;
  value: number;
  sampleCount: number;
  source: string;
  partial?: boolean;
}

interface ListEnvelope {
  data: {
    measurements: DayRow[];
    meta: { total: number; limit: number; offset: number; groupBy?: string };
  };
}

const DAYS = 1000;
const SAMPLES_PER_DAY = 6;
const PAGE = 25;

/** UTC calendar key of `now` shifted back `daysAgo` days. */
function dayKeyAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** A day is left empty when this holds, so gaps never count as days. */
const isGap = (daysAgo: number) => daysAgo % 10 === 3;

async function seedSession(username: string) {
  const prisma = getPrismaClient();
  const user = await prisma.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      role: "USER",
      timezone: "Europe/Berlin",
    },
  });
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
  });
  cookieJar.set("healthlog_session", session.id);
  return user;
}

/**
 * Seeds `DAYS` days of step chunks ending yesterday. Each chunk sits between
 * 08:00 and 13:00 UTC, which is the same calendar day in Berlin all year.
 * Every fifth day also carries a Withings total that the source ladder must
 * drop rather than add.
 */
async function seedHistory(userId: string) {
  const rows: Array<{
    userId: string;
    type: "ACTIVITY_STEPS";
    value: number;
    unit: string;
    source: "APPLE_HEALTH" | "WITHINGS";
    measuredAt: Date;
    externalId: string;
  }> = [];
  const expected = new Map<string, number>();
  for (let daysAgo = 1; daysAgo <= DAYS; daysAgo++) {
    if (isGap(daysAgo)) continue;
    const key = dayKeyAgo(daysAgo);
    let sum = 0;
    for (let i = 0; i < SAMPLES_PER_DAY; i++) {
      const value = 100 * (i + 1) + (daysAgo % 7);
      sum += value;
      rows.push({
        userId,
        type: "ACTIVITY_STEPS",
        value,
        unit: "steps",
        source: "APPLE_HEALTH",
        measuredAt: new Date(`${key}T${String(8 + i).padStart(2, "0")}:00:00Z`),
        externalId: `uuid-${key}-${i}`,
      });
    }
    if (daysAgo % 5 === 0) {
      rows.push({
        userId,
        type: "ACTIVITY_STEPS",
        value: 99_999,
        unit: "steps",
        source: "WITHINGS",
        measuredAt: new Date(`${key}T10:30:00Z`),
        externalId: `withings-${key}`,
      });
    }
    expected.set(key, sum);
  }
  await getPrismaClient().measurement.createMany({ data: rows });
  return { expected, rawRows: rows.length };
}

async function callList(query: string): Promise<Response> {
  const { GET } = await import("@/app/api/measurements/route");
  return GET(new NextRequest(`http://localhost/api/measurements?${query}`));
}

describe("GET /api/measurements?groupBy=day paging (#1245)", () => {
  it("pages over every day exactly once, whole, with a small first page", async () => {
    const user = await seedSession("day-paging-user");
    const { expected, rawRows } = await seedHistory(user.id);
    // The history is longer than the raw-row cap the list used to read.
    expect(rawRows).toBeGreaterThan(5000);

    const first = await callList(
      `type=ACTIVITY_STEPS&groupBy=day&limit=${PAGE}&offset=0`,
    );
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const firstBody = JSON.parse(firstText) as ListEnvelope;
    expect(firstBody.data.meta.total).toBe(expected.size);
    expect(firstBody.data.meta.groupBy).toBe("day");
    expect(firstBody.data.measurements).toHaveLength(PAGE);
    // A page is a page, not the history.
    expect(firstText.length).toBeLessThan(20_000);
    // Newest first: the first row is yesterday.
    expect(firstBody.data.measurements[0].dayKey).toBe(dayKeyAgo(1));

    const seen: string[] = [];
    let offset = 0;
    let pages = 0;
    while (offset < firstBody.data.meta.total) {
      const res = await callList(
        `type=ACTIVITY_STEPS&groupBy=day&limit=${PAGE}&offset=${offset}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListEnvelope;
      expect(body.data.meta.total).toBe(expected.size);
      expect(body.data.meta.offset).toBe(offset);
      for (const row of body.data.measurements) {
        seen.push(row.dayKey);
        // Whole day, canonical source only: the Withings total never adds.
        expect(row.value).toBe(expected.get(row.dayKey));
        expect(row.sampleCount).toBe(SAMPLES_PER_DAY);
        expect(row.source).toBe("APPLE_HEALTH");
        expect(row.partial).toBeUndefined();
      }
      offset += PAGE;
      pages += 1;
    }
    expect(pages).toBe(Math.ceil(expected.size / PAGE));
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...expected.keys()].sort());
    // Descending across page boundaries, not just within a page.
    expect(seen).toEqual([...seen].sort().reverse());

    // Past the end: an empty page that still reports the total.
    const past = (await (
      await callList(
        `type=ACTIVITY_STEPS&groupBy=day&limit=${PAGE}&offset=${expected.size + PAGE}`,
      )
    ).json()) as ListEnvelope;
    expect(past.data.measurements).toEqual([]);
    expect(past.data.meta.total).toBe(expected.size);
  });

  it("starts at the oldest day ascending and counts only the filtered window", async () => {
    const user = await seedSession("day-paging-window-user");
    const { expected } = await seedHistory(user.id);

    const asc = (await (
      await callList(
        `type=ACTIVITY_STEPS&groupBy=day&limit=${PAGE}&sortDir=asc`,
      )
    ).json()) as ListEnvelope;
    expect(asc.data.measurements[0].dayKey).toBe(dayKeyAgo(DAYS));
    expect(asc.data.measurements[0].value).toBe(expected.get(dayKeyAgo(DAYS)));

    // A 30-day window: from the start of day 30 ago to the end of yesterday.
    const from = `${dayKeyAgo(30)}T00:00:00Z`;
    const to = `${dayKeyAgo(1)}T23:59:59Z`;
    const windowed = (await (
      await callList(
        `type=ACTIVITY_STEPS&groupBy=day&limit=${PAGE}&from=${from}&to=${to}`,
      )
    ).json()) as ListEnvelope;
    let inWindow = 0;
    for (let daysAgo = 1; daysAgo <= 30; daysAgo++) {
      if (!isGap(daysAgo)) inWindow += 1;
    }
    expect(windowed.data.meta.total).toBe(inWindow);
    expect(windowed.data.measurements).toHaveLength(PAGE);
  });
});
