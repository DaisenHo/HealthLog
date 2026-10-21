/**
 * `POST /api/strava/disconnect` leaves nothing of the connected account behind
 * that a later connection would inherit: not the tokens, and not the backfill
 * markers. A resume point left standing made the next account's first walk
 * start below the old account's oldest activity, so its newer history was
 * never asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-handler", () => ({
  apiHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  requireAuth: vi.fn(async () => ({ user: { id: "u1" } })),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      update: vi.fn(),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  },
}));
vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
  getEvent: () => null,
}));
vi.mock("@/lib/auth/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/integrations/status", () => ({ markDisconnected: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/strava/client", () => ({ deauthorize: vi.fn() }));
vi.mock("@/lib/strava/credentials", async (importOriginal) => ({
  STRAVA_DISCONNECTED: (
    await importOriginal<typeof import("@/lib/strava/credentials")>()
  ).STRAVA_DISCONNECTED,
  getStravaConnection: vi.fn(async () => ({ accessToken: "tok" })),
}));
vi.mock("@/lib/api-response", () => ({
  apiSuccess: (data: unknown) => ({ data, error: null, status: 200 }),
  apiError: (error: string, status: number) => ({ data: null, error, status }),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db";

const userUpdate = prisma.user.update as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  userUpdate.mockResolvedValue({});
});

describe("POST /api/strava/disconnect", () => {
  it("clears the backfill markers with the tokens", async () => {
    const res = (await (POST as unknown as () => Promise<{ data: unknown }>)())
      .data;
    expect(res).toEqual({ disconnected: true });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        stravaAccessTokenEncrypted: null,
        stravaRefreshTokenEncrypted: null,
        stravaAthleteId: null,
        stravaBackfillCompletedAt: null,
        stravaBackfillResumeBefore: null,
      },
    });
  });
});
