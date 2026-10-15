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

vi.mock("@/lib/oura/credentials", () => ({
  getOuraClientCredentials: vi.fn(async () => ({
    clientId: "c",
    clientSecret: "s",
  })),
}));

vi.mock("@/lib/integrations/status", () => ({
  getIntegrationStatus: vi.fn(async () => ({
    integration: "oura",
    state: "error_reauth",
    lastSuccessAt: null,
    lastAttemptAt: "2026-06-10T00:00:00.000Z",
    lastError: "http_401",
    consecutiveFailuresByKind: null,
  })),
}));

import { GET } from "../route";
import { prisma } from "@/lib/db";
import { getOuraClientCredentials } from "@/lib/oura/credentials";

const userFind = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const credsMock = getOuraClientCredentials as ReturnType<typeof vi.fn>;

type Body = {
  connected: boolean;
  available: boolean;
  state?: string;
  lastError?: string | null;
};
const call = () =>
  (GET as unknown as () => Promise<{ data: Body }>)().then((r) => r.data);

describe("GET /api/oura/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credsMock.mockResolvedValue({ clientId: "c", clientSecret: "s" });
  });

  it("reports not-connected but available", async () => {
    userFind.mockResolvedValue({ ouraAccessTokenEncrypted: null });
    const res = await call();
    expect(res.connected).toBe(false);
    expect(res.available).toBe(true);
  });

  it("surfaces the ledger reauth state when connected", async () => {
    userFind.mockResolvedValue({ ouraAccessTokenEncrypted: "enc" });
    const res = await call();
    expect(res.connected).toBe(true);
    expect(res.state).toBe("error_reauth");
    expect(res.lastError).toBe("http_401");
  });

  it("never returns the token", async () => {
    userFind.mockResolvedValue({ ouraAccessTokenEncrypted: "enc-secret" });
    const res = (await call()) as Record<string, unknown>;
    expect(JSON.stringify(res)).not.toContain("enc-secret");
  });
});
