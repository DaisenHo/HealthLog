import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    device: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    refreshToken: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    apiToken: {
      updateMany: vi.fn(),
    },
    // v1.4.23 — the cascade now runs through `prisma.$transaction`
    // (HIGH 6 fix). The mock returns the resolved batch payload so the
    // route handler walks past the transaction step.
    $transaction: vi.fn().mockResolvedValue([] as never),
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

import { DELETE } from "../route";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

const SESSION_OK = {
  session: { id: "sess-1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: { id: "user-1", username: "testuser", role: "USER" as const },
};

function req(): NextRequest {
  return new NextRequest("http://localhost/api/auth/me/devices/dev-x", {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([]);
  vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({
    count: 0,
  } as never);
  vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({
    count: 0,
  } as never);
  vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
});

describe("DELETE /api/auth/me/devices/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await DELETE(req(), {
      params: Promise.resolve({ id: "dev-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the device doesn't exist", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    vi.mocked(prisma.device.findUnique).mockResolvedValue(null);
    const res = await DELETE(req(), {
      params: Promise.resolve({ id: "dev-x" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the device belongs to another user (no enumeration)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    vi.mocked(prisma.device.findUnique).mockResolvedValue({
      id: "dev-x",
      userId: "user-2",
      model: "iPhone",
      bundleId: "io.healthlog.app",
    } as never);
    const res = await DELETE(req(), {
      params: Promise.resolve({ id: "dev-x" }),
    });
    expect(res.status).toBe(404);
    expect(vi.mocked(prisma.device.delete)).not.toHaveBeenCalled();
  });

  it("revokes refresh tokens + access tokens + deletes the device row", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    vi.mocked(prisma.device.findUnique).mockResolvedValue({
      id: "dev-1",
      userId: "user-1",
      model: "iPhone",
      bundleId: "io.healthlog.app",
    } as never);
    vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([
      { accessTokenHash: "hash:a1" },
      { accessTokenHash: "hash:a2" },
      { accessTokenHash: null },
    ] as never);
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({
      count: 3,
    } as never);
    vi.mocked(prisma.apiToken.updateMany).mockResolvedValue({
      count: 2,
    } as never);
    vi.mocked(prisma.device.delete).mockResolvedValue({ id: "dev-1" } as never);

    const res = await DELETE(req(), {
      params: Promise.resolve({ id: "dev-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(true);
    expect(body.data.refreshTokensRevoked).toBe(3);
    expect(body.data.accessTokensRevoked).toBe(2);
    expect(vi.mocked(prisma.device.delete)).toHaveBeenCalledWith({
      where: { id: "dev-1" },
    });
    // The refresh-token revoke filter MUST scope to the deviceId, not
    // every refresh row the user has.
    const updateCall = vi.mocked(prisma.refreshToken.updateMany).mock
      .calls[0]?.[0];
    expect(updateCall?.where).toMatchObject({
      userId: "user-1",
      deviceId: "dev-1",
      revokedAt: null,
    });
  });
});
