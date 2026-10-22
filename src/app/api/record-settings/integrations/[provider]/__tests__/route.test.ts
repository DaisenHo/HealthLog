import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireGuardianAuth: vi.fn(),
  access: vi.fn(),
  share: vi.fn(async () => undefined),
  hasApp: vi.fn(async () => true),
  start: vi.fn(),
  disconnect: vi.fn(),
  rate: vi.fn(async () => ({ allowed: true })),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api-handler", () => ({
  apiHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  requireGuardianAuth: m.requireGuardianAuth,
  SharingAccessDeniedError: class SharingAccessDeniedError extends Error {},
}));
vi.mock("@/lib/record-settings", () => ({
  resolveGuardianRecordSettingsAccess: m.access,
}));
vi.mock("@/lib/integrations/oauth-kit/connect-target", () => ({
  shareGuardianClientApp: m.share,
}));
vi.mock("@/lib/integrations/oauth-kit/connect-start", async (orig) => ({
  ...(await orig<
    typeof import("@/lib/integrations/oauth-kit/connect-start")
  >()),
  recordHasClientApp: m.hasApp,
  startOAuthConnect: m.start,
}));
vi.mock("@/lib/integrations/oauth-kit/disconnect", () => ({
  disconnectOAuth: m.disconnect,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: m.rate,
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/auth/audit", () => ({ auditLog: m.audit }));
vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("@/lib/auth/secure-cookie", () => ({
  shouldEmitSecureCookie: () => true,
}));

import { POST as connect } from "../connect/route";
import { POST as disconnect } from "../disconnect/route";

const params = (provider: string) => ({
  params: Promise.resolve({ provider }),
});
const req = {} as NextRequest;
const GUARDED = {
  actorId: "guardian",
  recordId: "profile",
  recordKind: "managed",
  relationship: "guardian",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.requireGuardianAuth.mockResolvedValue({});
  m.access.mockReturnValue(GUARDED);
  m.rate.mockResolvedValue({ allowed: true });
});

describe("POST /api/record-settings/integrations/[provider]/connect", () => {
  it("refuses a provider outside the set before authenticating", async () => {
    const res = await connect(req, params("fitbit"));
    expect(res.status).toBe(404);
    expect(m.requireGuardianAuth).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not a guardian of a managed record", async () => {
    m.access.mockReturnValue(null);
    await expect(connect(req, params("oura"))).rejects.toThrow();
    expect(m.start).not.toHaveBeenCalled();
  });

  it("mints the state for the managed record and answers with the consent URL", async () => {
    m.start.mockResolvedValue({
      ok: true,
      authorizationUrl: "https://cloud.ouraring.com/oauth/authorize?state=s",
      cookie: { name: "oura_oauth_state", value: "s", maxAgeSeconds: 600 },
    });
    const res = await connect(req, params("oura"));
    expect(m.share).toHaveBeenCalledWith(
      "oura",
      { recordUserId: "profile", actorUserId: "guardian" },
      expect.any(Function),
    );
    expect(m.start).toHaveBeenCalledWith("oura", "profile");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      recordId: "profile",
      provider: "oura",
      authorizationUrl: "https://cloud.ouraring.com/oauth/authorize?state=s",
    });
    expect(res.headers.get("set-cookie")).toContain("oura_oauth_state=s");
    expect(res.headers.get("set-cookie")?.toLowerCase()).toContain("httponly");
    expect(m.audit).toHaveBeenCalledWith("integration.connect.started", {
      userId: "profile",
      details: { provider: "oura" },
    });
  });

  it("answers 409 when no provider app can be found", async () => {
    m.start.mockResolvedValue({ ok: false, reason: "nocreds" });
    const res = await connect(req, params("strava"));
    expect(res.status).toBe(409);
  });

  it("is rate limited per record", async () => {
    m.rate.mockResolvedValue({ allowed: false });
    const res = await connect(req, params("withings"));
    expect(res.status).toBe(429);
    expect(m.rate).toHaveBeenCalledWith(
      "withings:connect:profile",
      expect.any(Number),
      expect.any(Number),
    );
  });
});

describe("POST /api/record-settings/integrations/[provider]/disconnect", () => {
  it("disconnects the managed record", async () => {
    m.disconnect.mockResolvedValue("disconnected");
    const res = await disconnect(req, params("google-health"));
    expect(m.disconnect).toHaveBeenCalledWith("google-health", "profile");
    expect(res.status).toBe(200);
  });

  it("answers 404 when the record is not connected", async () => {
    m.disconnect.mockResolvedValue("not_connected");
    const res = await disconnect(req, params("whoop"));
    expect(res.status).toBe(404);
  });

  it("refuses a provider outside the set", async () => {
    const res = await disconnect(req, params("nightscout"));
    expect(res.status).toBe(404);
    expect(m.disconnect).not.toHaveBeenCalled();
  });
});
