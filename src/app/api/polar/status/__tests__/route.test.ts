import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-handler", () => ({
  apiHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  requireAuth: vi.fn(async () => ({ user: { id: "u1" } })),
}));

vi.mock("@/lib/integrations/connection-health-load", () => ({
  loadOneConnectionHealth: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));

vi.mock("@/lib/api-response", () => ({
  apiSuccess: (data: unknown) => ({ data, error: null }),
}));

vi.mock("@/lib/polar/credentials", () => ({
  getPolarClientCredentials: vi.fn(async () => ({
    clientId: "c",
    clientSecret: "s",
  })),
}));

vi.mock("@/lib/integrations/status", () => ({
  getIntegrationStatus: vi.fn(async () => ({
    integration: "polar",
    state: "connected",
    lastSuccessAt: "2026-06-10T00:00:00.000Z",
    lastAttemptAt: "2026-06-10T00:00:00.000Z",
    lastError: null,
    consecutiveFailuresByKind: null,
  })),
}));

import { GET } from "../route";
import { prisma } from "@/lib/db";
import { getPolarClientCredentials } from "@/lib/polar/credentials";

const userFind = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const credsMock = getPolarClientCredentials as ReturnType<typeof vi.fn>;

type Body = {
  connected: boolean;
  configured: boolean;
  available: boolean;
  state?: string;
};
const call = () =>
  (GET as unknown as () => Promise<{ data: Body }>)().then((r) => r.data);

describe("GET /api/polar/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credsMock.mockResolvedValue({ clientId: "c", clientSecret: "s" });
  });

  it("reports not-connected but available when env is set and no token stored", async () => {
    userFind.mockResolvedValue({ polarAccessTokenEncrypted: null });
    const res = await call();
    expect(res.connected).toBe(false);
    expect(res.available).toBe(true);
  });

  it("reports available=false when the server has no Polar app configured", async () => {
    credsMock.mockResolvedValue(null);
    userFind.mockResolvedValue(null);
    const res = await call();
    expect(res.available).toBe(false);
    expect(res.connected).toBe(false);
  });

  it("reports connected + ledger state when a token is stored", async () => {
    userFind.mockResolvedValue({ polarAccessTokenEncrypted: "enc" });
    const res = await call();
    expect(res.connected).toBe(true);
    expect(res.configured).toBe(true);
    expect(res.state).toBe("connected");
  });

  it("never returns the token", async () => {
    userFind.mockResolvedValue({ polarAccessTokenEncrypted: "enc" });
    const res = (await call()) as Record<string, unknown>;
    expect(JSON.stringify(res)).not.toContain("enc");
  });
});
