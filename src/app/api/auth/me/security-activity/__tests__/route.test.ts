import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
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
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const SESSION_OK = {
  session: { id: "sess-1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: { id: "user-1", username: "u", role: "USER" as const, locale: "en" },
};

const req = (qs = "") =>
  new NextRequest(`http://localhost/api/auth/me/security-activity${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
});

describe("GET /api/auth/me/security-activity", () => {
  it("reads one row past the requested page, in a total order", async () => {
    const res = await GET(req("?limit=10"));
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.auditLog.findMany).mock.calls[0][0] as {
      take: number;
      orderBy: unknown;
    };
    expect(call.take).toBe(11);
    expect(call.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    const body = (await res.json()) as {
      meta: { truncated: boolean; limit: number };
    };
    expect(body.meta).toMatchObject({ truncated: false, limit: 10 });
  });

  it("answers a limit past the published ceiling with a 422 naming it", async () => {
    const res = await GET(req("?limit=500"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      meta: { errorCode: string };
      details: { issues: Array<{ path: string }> };
    };
    expect(body.meta.errorCode).toBe("security_activity.invalid");
    expect(body.details.issues.map((i) => i.path)).toEqual(["limit"]);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});
