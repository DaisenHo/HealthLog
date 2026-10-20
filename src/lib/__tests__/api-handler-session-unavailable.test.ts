/**
 * A session store that cannot be read answers 503 through `requireAuth`.
 *
 * The other half of the session-lookup fix: `session.ts` raises the typed
 * error, and this proves it reaches the wire as a retryable 503 with its code
 * rather than as the 401 that tells a client to throw its credential away.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/hmac", () => ({ hashToken: vi.fn() }));
vi.mock("@/lib/auth/audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));
vi.mock("@/lib/monitoring/glitchtip", () => ({
  sendGlitchtipEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

import { NextRequest } from "next/server";
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiSuccess } from "@/lib/api-response";
import { SessionStoreUnavailableError } from "@/lib/api-errors";
import { getSession } from "@/lib/auth/session";

describe("requireAuth on a failed session lookup", () => {
  it("answers 503 with auth.session.unavailable, not 401", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(
      new SessionStoreUnavailableError(new Error("pool timeout")),
    );
    const route = apiHandler(async (_request: NextRequest) => {
      await requireAuth();
      return apiSuccess({ ok: true });
    });
    const res = await route(new NextRequest("http://localhost/api/probe"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.meta.errorCode).toBe("auth.session.unavailable");
  });
});
