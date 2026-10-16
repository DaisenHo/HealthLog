import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    personalRecord: {
      findMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    measurement: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth/audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

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
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

const SESSION_OK = {
  session: { id: "sess-1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: { id: "user-1", username: "testuser", role: "USER" as const },
};

function req(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.personalRecord.findMany).mockResolvedValue([]);
});

describe("GET /api/personal-records", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(req("http://localhost/api/personal-records"));
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a user with no records", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const res = await GET(req("http://localhost/api/personal-records"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; error: null };
    expect(body.data).toEqual([]);
    expect(body.error).toBeNull();
    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { achievedAt: "desc" },
      take: 100,
    });
  });

  it("passes through a valid metricType filter", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const res = await GET(
      req("http://localhost/api/personal-records?metricType=VO2_MAX"),
    );
    expect(res.status).toBe(200);
    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", metricType: "VO2_MAX" },
      orderBy: { achievedAt: "desc" },
      take: 100,
    });
  });

  // Was "drops an unknown metricType silently (loose-typed filter contract)".
  // That test pinned the defect rather than the contract: dropping the filter
  // does not degrade gracefully, it WIDENS the read to every metric, so a
  // typo returned more of the record than the caller asked for and the 200
  // said nothing about it.
  it("refuses an unknown metricType instead of widening the read", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const res = await GET(
      req("http://localhost/api/personal-records?metricType=BOGUS"),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      meta?: { errorCode?: string };
      details?: { issues?: Array<{ path: string }> };
    };
    expect(body.meta?.errorCode).toBe("personal_records.invalid_query");
    expect(body.details?.issues?.map((i) => i.path)).toContain("metricType");
    expect(prisma.personalRecord.findMany).not.toHaveBeenCalled();
  });

  it("honours an explicit ?limit param", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const res = await GET(
      req("http://localhost/api/personal-records?limit=25"),
    );
    expect(res.status).toBe(200);
    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { achievedAt: "desc" },
      take: 25,
    });
  });

  it("serves the ceiling itself", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const res = await GET(
      req("http://localhost/api/personal-records?limit=500"),
    );
    expect(res.status).toBe(200);
    expect(prisma.personalRecord.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { achievedAt: "desc" },
      take: 500,
    });
  });

  // Was "clamps ?limit to the project-wide ceiling of 500". Silently serving
  // 500 rows to a caller that asked for 999 999 is the same class of quiet
  // substitution as the default-fallback below: the answer differs from the
  // question and nothing says so.
  it("refuses a ?limit above the ceiling instead of clamping", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const res = await GET(
      req("http://localhost/api/personal-records?limit=999999"),
    );
    expect(res.status).toBe(422);
    expect(prisma.personalRecord.findMany).not.toHaveBeenCalled();
  });

  // Was "falls back to default on garbage ?limit (defence-in-depth)". A
  // fallback that cannot be observed is not defence, it is a typo the caller
  // never learns about.
  it.each(["abc", "-1", "0", "2.5"])(
    "refuses a garbage ?limit=%s",
    async (value) => {
      vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
      const res = await GET(
        req(`http://localhost/api/personal-records?limit=${value}`),
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { meta?: { errorCode?: string } };
      expect(body.meta?.errorCode).toBe("personal_records.invalid_query");
      expect(prisma.personalRecord.findMany).not.toHaveBeenCalled();
    },
  );

  it("seeded record round-trips through the response", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const fakeRecord = {
      id: "pr-1",
      userId: "user-1",
      metricType: "VO2_MAX",
      metricSlot: null,
      direction: "MAX",
      value: 47.2,
      unit: "mL/(kg·min)",
      achievedAt: new Date("2026-05-01T07:00:00.000Z"),
      sourceMeasurementId: "m-1",
      source: "APPLE_HEALTH",
      externalId: null,
      createdAt: new Date(),
    };
    vi.mocked(prisma.personalRecord.findMany).mockResolvedValue([
      fakeRecord,
    ] as never);
    const res = await GET(req("http://localhost/api/personal-records"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ value: number; metricType: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].value).toBe(47.2);
    expect(body.data[0].metricType).toBe("VO2_MAX");
  });

  // v1.43 (ios #116 item 5) — every stored field stays, and the band for the
  // age the record was set at rides beside it.
  it("projects every stored field and adds the benchmark", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    const createdAt = new Date("2026-05-02T00:00:00.000Z");
    vi.mocked(prisma.personalRecord.findMany).mockResolvedValue([
      {
        id: "pr-1",
        userId: "user-1",
        metricType: "VO2_MAX",
        metricSlot: null,
        direction: "MAX",
        value: 47.2,
        unit: "mL/(kg·min)",
        achievedAt: new Date("2026-05-01T07:00:00.000Z"),
        sourceMeasurementId: "m-1",
        source: "APPLE_HEALTH",
        externalId: "x-1",
        createdAt,
      },
      {
        id: "pr-2",
        userId: "user-1",
        metricType: "ACTIVITY_STEPS",
        metricSlot: null,
        direction: "MAX",
        value: 21000,
        unit: "steps",
        achievedAt: new Date("2026-04-01T07:00:00.000Z"),
        sourceMeasurementId: null,
        source: "APPLE_HEALTH",
        externalId: null,
        createdAt,
      },
    ] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      dateOfBirth: new Date("1981-03-10T00:00:00.000Z"),
      gender: "MALE",
      heightCm: 180,
    } as never);
    const res = await GET(req("http://localhost/api/personal-records"));
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(Object.keys(body.data[0]).sort()).toEqual(
      [
        "achievedAt",
        "benchmark",
        "createdAt",
        "direction",
        "externalId",
        "id",
        "metricSlot",
        "metricType",
        "source",
        "sourceMeasurementId",
        "unit",
        "userId",
        "value",
      ].sort(),
    );
    // 45 when the record was set: between the 40s and 50s male FRIEND bands.
    expect(body.data[0].benchmark).toMatchObject({
      unit: "mL/(kg·min)",
      source: "friend_2015",
    });
    const band = body.data[0].benchmark as { low: number; high: number };
    expect(band.low).toBeGreaterThan(31);
    expect(band.high).toBeLessThan(49);
    // A step record has no cited norm.
    expect(body.data[1].benchmark).toBeNull();
    // No six-minute walk on the page, so no weight read.
    expect(prisma.measurement.findFirst).not.toHaveBeenCalled();
  });
});
