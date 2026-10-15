/**
 * `PUT /api/auth/me/ai-usage` (#1217): the account's own level, within the
 * operator's ceiling. A level above it is refused with 422
 * `ai.usage.aboveCeiling` and `meta.maxLevel`, never capped silently; `null`
 * returns to the instance default; the answer is the resolved `ai.usage`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  stored: null as string | null,
  settings: {
    aiUsageMaxLevel: "STANDARD",
    aiUsageDefaultLevel: "STANDARD",
    aiSyncRegenGapHours: null,
  } as Record<string, unknown>,
  usage: [] as Array<{ totalTokens: number }>,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        aiUsageLevel: db.stored,
        timezone: "UTC",
      })),
      update: vi.fn(async (args: { data: { aiUsageLevel: string | null } }) => {
        db.stored = args.data.aiUsageLevel;
        return {};
      }),
    },
    appSettings: { findUnique: vi.fn(async () => db.settings) },
    coachUsage: { findMany: vi.fn(async () => db.usage) },
  },
}));
vi.mock("@/lib/tz/resolver", () => ({
  resolveUserTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));
vi.mock("@/lib/db-compat", () => ({
  ensureDbCompatibility: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitHeaders: () => ({}),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

import { PUT } from "../route";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { auditLog } from "@/lib/auth/audit";
import { checkRateLimit } from "@/lib/rate-limit";

const SESSION_OK = {
  session: { id: "sess-1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: { id: "user-1", username: "testuser", role: "USER" as const },
};

const put = PUT as unknown as (req: Request) => Promise<Response>;

function req(body: unknown): Request {
  return new Request("http://localhost/api/auth/me/ai-usage", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.stored = null;
  db.settings = {
    aiUsageMaxLevel: "STANDARD",
    aiUsageDefaultLevel: "STANDARD",
    aiSyncRegenGapHours: null,
  };
  db.usage = [];
  vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 29,
    resetAt: Date.now() + 3_600_000,
  } as never);
});

describe("PUT /api/auth/me/ai-usage", () => {
  it("stores a level within the ceiling and answers the resolved state", async () => {
    db.usage = [
      { totalTokens: 90_000 },
      { totalTokens: 110_000 },
      { totalTokens: 100_000 },
    ];
    const res = await put(req({ level: "frugal" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update).mock.calls[0]![0]).toEqual({
      where: { id: "user-1" },
      data: { aiUsageLevel: "FRUGAL" },
    });
    const { data } = await res.json();
    expect(data).toMatchObject({
      level: "frugal",
      preference: "frugal",
      defaultLevel: "standard",
      maxLevel: "standard",
      source: "user",
      measuredTokensPerDay: 100_000,
      measuredDays: 3,
    });
    expect(data.options).toEqual([
      { level: "frugal", allowed: true, estimatedTokensPerDay: 100_000 },
      { level: "standard", allowed: true, estimatedTokensPerDay: 200_000 },
      { level: "full", allowed: false, estimatedTokensPerDay: 666_667 },
    ]);
    expect(auditLog).toHaveBeenCalledWith(
      "user.aiUsage.update",
      expect.objectContaining({
        userId: "user-1",
        details: { previous: null, next: "frugal" },
      }),
    );
  });

  it("refuses a level above the ceiling with the ceiling named", async () => {
    const res = await put(req({ level: "full" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.meta).toMatchObject({
      errorCode: "ai.usage.aboveCeiling",
      maxLevel: "standard",
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("accepts full once the operator allows it", async () => {
    db.settings = { ...db.settings, aiUsageMaxLevel: "FULL" };
    const res = await put(req({ level: "full" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.level).toBe("full");
  });

  it("returns to the instance default on null", async () => {
    db.stored = "FRUGAL";
    const res = await put(req({ level: null }));
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update).mock.calls[0]![0].data).toEqual({
      aiUsageLevel: null,
    });
    const { data } = await res.json();
    expect(data).toMatchObject({
      level: "standard",
      preference: null,
      source: "default",
    });
    // Fewer than three days of history: no estimate.
    expect(
      data.options.every(
        (o: { estimatedTokensPerDay: number | null }) =>
          o.estimatedTokensPerDay === null,
      ),
    ).toBe(true);
  });

  it.each([
    [{ level: "lavish" }],
    [{}],
    [{ level: "frugal", extra: true }],
    [{ level: 1 }],
  ])("refuses %j as invalid", async (body) => {
    const res = await put(req(body));
    expect(res.status).toBe(422);
    expect((await res.json()).meta.errorCode).toBe("ai.usage.invalid");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses the 31st change in an hour", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    } as never);
    const res = await put(req({ level: "frugal" }));
    expect(res.status).toBe(429);
    expect((await res.json()).meta.errorCode).toBe("ai.usage.rateLimited");
    expect(vi.mocked(checkRateLimit).mock.calls[0]!.slice(1)).toEqual([
      30,
      60 * 60 * 1000,
    ]);
  });

  it("refuses a caller without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await put(req({ level: "frugal" }));
    expect(res.status).toBe(401);
  });
});
