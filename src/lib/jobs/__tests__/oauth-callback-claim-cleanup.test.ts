/**
 * Expired OAuth callback claims are swept by the daily OAuth-state cleanup,
 * not only when a callback completes: a quiet instance may not see another
 * connect for weeks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  withingsCleanup: vi.fn(),
  claimDeleteMany: vi.fn(),
  meta: {} as Record<string, unknown>,
}));

vi.mock("@/lib/jobs/withings-oauth-state-cleanup", () => ({
  cleanupExpiredWithingsOAuthStates: h.withingsCleanup,
}));
vi.mock("../reminder/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWorkerPrisma: () => ({
    oAuthCallbackClaim: { deleteMany: h.claimDeleteMany },
  }),
}));
vi.mock("@/lib/logging/background", () => ({
  withBackgroundEvent: async (
    _name: string,
    fn: (evt: {
      addMeta: (k: string, v: unknown) => void;
      addWarning: (w: string) => void;
    }) => Promise<unknown>,
  ) =>
    fn({
      addMeta: (k, v) => {
        h.meta[k] = v;
      },
      addWarning: () => {},
    }),
}));

import { cleanupExpiredOAuthCallbackClaims } from "../oauth-callback-claim-cleanup";
import { handleWithingsOAuthStateCleanup } from "../reminder/cleanup-handlers";

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.meta)) delete h.meta[key];
  h.withingsCleanup.mockResolvedValue(0);
  h.claimDeleteMany.mockResolvedValue({ count: 3 });
});

describe("cleanupExpiredOAuthCallbackClaims", () => {
  it("deletes the claims whose expiry has passed and returns the count", async () => {
    const now = new Date("2026-10-21T03:20:00Z");
    const deleted = await cleanupExpiredOAuthCallbackClaims(
      { oAuthCallbackClaim: { deleteMany: h.claimDeleteMany } } as never,
      now,
    );
    expect(deleted).toBe(3);
    expect(h.claimDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
  });
});

describe("daily OAuth-state cleanup", () => {
  it("sweeps expired callback claims alongside the Withings states", async () => {
    await handleWithingsOAuthStateCleanup([]);
    expect(h.withingsCleanup).toHaveBeenCalledTimes(1);
    expect(h.claimDeleteMany).toHaveBeenCalledTimes(1);
    expect(h.meta.oauth_callback_claim_cleanup_deleted).toBe(3);
  });

  it("fails the job when the claim sweep fails", async () => {
    h.claimDeleteMany.mockRejectedValue(new Error("statement timeout"));
    await expect(handleWithingsOAuthStateCleanup([])).resolves.toMatchObject({
      ok: false,
    });
  });
});
