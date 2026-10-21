/**
 * POST /api/fitbit/sync once Google has turned the Fitbit Web API off: a
 * clear 410 naming the cause, and no sync attempt behind it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as ApiHandlerModule from "@/lib/api-handler";

const { syncUserFitbitMock } = vi.hoisted(() => ({
  syncUserFitbitMock: vi.fn(),
}));

vi.mock("@/lib/api-handler", async () => {
  const actual =
    await vi.importActual<typeof ApiHandlerModule>("@/lib/api-handler");
  return {
    ...actual,
    requireAuth: vi.fn(async () => ({ user: { id: "u1" } })),
  };
});
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/fitbit/sync", () => ({ syncUserFitbit: syncUserFitbitMock }));

import { POST } from "../route";
import { isFitbitRetired } from "@/lib/fitbit/retirement";

const post = POST as unknown as (r: NextRequest) => Promise<Response>;

function request(): NextRequest {
  return new NextRequest("http://localhost/api/fitbit/sync", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  syncUserFitbitMock.mockResolvedValue({ imported: 2, failed: false });
});

describe("POST /api/fitbit/sync", () => {
  it("syncs while the Web API is still up", async () => {
    const response = await post(request());
    expect(response.status).toBe(200);
    expect(syncUserFitbitMock).toHaveBeenCalledWith("u1", {
      fullSync: false,
    });
  });

  it("answers 410 provider_retired after the turndown and syncs nothing", async () => {
    vi.mocked(isFitbitRetired).mockReturnValue(true);
    try {
      const response = await post(request());
      expect(response.status).toBe(410);
      const body = (await response.json()) as {
        error: string;
        meta?: { errorCode?: string };
      };
      expect(body.meta?.errorCode).toBe("provider_retired");
      expect(body.error).toMatch(/Google Health/);
      expect(syncUserFitbitMock).not.toHaveBeenCalled();
    } finally {
      vi.mocked(isFitbitRetired).mockReturnValue(false);
    }
  });
});
