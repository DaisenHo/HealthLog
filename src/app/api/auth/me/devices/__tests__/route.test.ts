import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    device: {
      findMany: vi.fn(),
    },
    refreshToken: {
      findFirst: vi.fn(),
    },
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
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

const SESSION_OK = {
  session: { id: "sess-1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: { id: "user-1", username: "testuser", role: "USER" as const },
};

function req(deviceIdHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (deviceIdHeader) headers["x-device-id"] = deviceIdHeader;
  return new NextRequest("http://localhost/api/auth/me/devices", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.device.findMany).mockResolvedValue([]);
  vi.mocked(prisma.refreshToken.findFirst).mockResolvedValue(null);
});

describe("GET /api/auth/me/devices", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("lists devices owned by the current user", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    vi.mocked(prisma.device.findMany).mockResolvedValue([
      {
        id: "dev-1",
        userId: "user-1",
        platform: "ios",
        token: "tok-1",
        bundleId: "io.healthlog.app",
        locale: "en-US",
        appVersion: "1.0",
        model: "iPhone 14 Pro",
        apnsToken: "aaaa",
        apnsEnvironment: "production",
        lastSeen: new Date("2026-05-10T12:00:00Z"),
        createdAt: new Date("2026-05-01T12:00:00Z"),
        updatedAt: new Date("2026-05-10T12:00:00Z"),
      },
      {
        id: "dev-2",
        userId: "user-1",
        platform: "ios",
        token: "tok-2",
        bundleId: "io.healthlog.app",
        locale: null,
        appVersion: null,
        model: "iPad Pro",
        apnsToken: null,
        apnsEnvironment: null,
        lastSeen: new Date("2026-05-09T12:00:00Z"),
        createdAt: new Date("2026-04-01T12:00:00Z"),
        updatedAt: new Date("2026-05-09T12:00:00Z"),
      },
    ] as never);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.devices).toHaveLength(2);
    expect(body.data.devices[0].id).toBe("dev-1");
    expect(body.data.devices[0].channels).toEqual(["web_push", "apns"]);
    expect(body.data.devices[1].channels).toEqual(["web_push"]);
  });

  it("marks the matching device as isCurrent when X-Device-Id is anchored by an unrevoked refresh token", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    vi.mocked(prisma.refreshToken.findFirst).mockResolvedValue({
      id: "rt-1",
    } as never);
    vi.mocked(prisma.device.findMany).mockResolvedValue([
      {
        id: "dev-1",
        userId: "user-1",
        platform: "ios",
        token: "tok-1",
        bundleId: "io.healthlog.app",
        locale: null,
        appVersion: null,
        model: "iPhone",
        apnsToken: null,
        apnsEnvironment: null,
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "dev-2",
        userId: "user-1",
        platform: "ios",
        token: "tok-2",
        bundleId: "io.healthlog.app",
        locale: null,
        appVersion: null,
        model: "iPad",
        apnsToken: null,
        apnsEnvironment: null,
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const res = await GET(req("dev-2"));
    const body = await res.json();
    const current = body.data.devices.find(
      (d: { isCurrent: boolean; id: string }) => d.isCurrent,
    );
    expect(current?.id).toBe("dev-2");
  });

  it("only queries devices for the authenticated user", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    await GET(req());
    const where = vi.mocked(prisma.device.findMany).mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ userId: "user-1" });
  });

  // v1.4.23 — a forged X-Device-Id header
  // pointing at a device the caller doesn't actually hold a credential
  // for must NOT flip `isCurrent: true`. The route now cross-checks the
  // header against an unrevoked RefreshToken row owned by the same
  // user; when no such row exists, every device returns
  // `isCurrent: false`.
  it("ignores a forged X-Device-Id header when no refresh token anchors it", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION_OK as never);
    vi.mocked(prisma.refreshToken.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.device.findMany).mockResolvedValue([
      {
        id: "dev-1",
        userId: "user-1",
        platform: "ios",
        token: "tok-1",
        bundleId: "io.healthlog.app",
        locale: null,
        appVersion: null,
        model: "iPhone",
        apnsToken: null,
        apnsEnvironment: null,
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "dev-2",
        userId: "user-1",
        platform: "ios",
        token: "tok-2",
        bundleId: "io.healthlog.app",
        locale: null,
        appVersion: null,
        model: "iPad",
        apnsToken: null,
        apnsEnvironment: null,
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    // Caller forges a header pointing at dev-2 but has no live
    // refresh-token bound to that device. Expectation: every device is
    // `isCurrent: false`.
    const res = await GET(req("dev-2"));
    const body = await res.json();
    expect(
      body.data.devices.every((d: { isCurrent: boolean }) => !d.isCurrent),
    ).toBe(true);

    // The refresh-token lookup must scope by userId AND deviceId AND
    // revokedAt: null — never trust the header without all three.
    const lookupWhere = vi.mocked(prisma.refreshToken.findFirst).mock
      .calls[0]?.[0]?.where;
    expect(lookupWhere).toEqual({
      userId: "user-1",
      deviceId: "dev-2",
      revokedAt: null,
    });
  });
});
