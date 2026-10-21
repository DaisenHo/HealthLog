import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The workout-route opt-in: off by default, a hard-set PATCH, audit-logged,
 * and a malformed body refused before anything is written.
 */

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
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
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
  }),
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

import { GET, PATCH } from "../route";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { auditLog } from "@/lib/auth/audit";

const SESSION_OK = {
  session: { id: "sess-1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: { id: "user-1", username: "testuser", role: "USER" as const },
};

function mkPatch(body: unknown): Request {
  return new Request("http://localhost/api/auth/me/workout-routes", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
});

describe("/api/auth/me/workout-routes", () => {
  it("reads off when the row carries no value", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await GET(
      new Request("http://localhost/api/auth/me/workout-routes") as never,
      { params: Promise.resolve({}) } as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { storeWorkoutRoutes: false },
    });
  });

  it("sets the flag field by field and audits the change", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      storeWorkoutRoutes: false,
    } as never);
    const res = await PATCH(
      mkPatch({ storeWorkoutRoutes: true }) as never,
      {
        params: Promise.resolve({}),
      } as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { storeWorkoutRoutes: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { storeWorkoutRoutes: true },
    });
    expect(auditLog).toHaveBeenCalledWith(
      "user.storeWorkoutRoutes.update",
      expect.objectContaining({
        details: { previous: false, next: true },
      }),
    );
  });

  it("refuses a malformed body with 422 and writes nothing", async () => {
    const res = await PATCH(
      mkPatch({ storeWorkoutRoutes: "yes" }) as never,
      {
        params: Promise.resolve({}),
      } as never,
    );
    expect(res.status).toBe(422);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await PATCH(
      mkPatch({ storeWorkoutRoutes: true }) as never,
      {
        params: Promise.resolve({}),
      } as never,
    );
    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
