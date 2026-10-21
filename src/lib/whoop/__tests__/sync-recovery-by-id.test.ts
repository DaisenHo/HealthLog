/**
 * The v2 recovery webhook carries the id of the associated SLEEP, and WHOOP
 * reads a recovery only through its cycle. The targeted refresh must resolve
 * sleep -> cycle -> recovery; passing the sleep UUID straight into the cycle
 * route answered 404 on every recovery webhook and booked a sync failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSleepById, fetchRecoveryByCycleId, upsertMock, fetchErrorMock } =
  vi.hoisted(() => ({
    fetchSleepById: vi.fn(),
    fetchRecoveryByCycleId: vi.fn(),
    upsertMock: vi.fn(async (_u: string, rows: unknown[]) => rows.length),
    fetchErrorMock: vi.fn(async () => 0),
  }));

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("../sync-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync-core")>()),
  getValidToken: vi.fn(async () => ({ accessToken: "tok" })),
  upsertWhoopMeasurements: upsertMock,
  handleCollectionFetchError: fetchErrorMock,
}));

vi.mock("../client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client")>()),
  fetchSleepById,
  fetchRecoveryByCycleId,
}));

import { syncWhoopRecoveryById } from "../sync-recovery";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncWhoopRecoveryById", () => {
  it("reads the sleep for its cycle id, then the recovery through the cycle", async () => {
    fetchSleepById.mockResolvedValue({ id: "sleep-uuid", cycle_id: 991 });
    fetchRecoveryByCycleId.mockResolvedValue({
      cycle_id: 991,
      sleep_id: "sleep-uuid",
      user_id: 42,
      created_at: "2026-06-01T07:00:00.000Z",
      updated_at: "2026-06-01T07:05:00.000Z",
      score_state: "SCORED",
      score: {
        user_calibrating: false,
        recovery_score: 70,
        resting_heart_rate: 52,
        hrv_rmssd_milli: 61,
      },
    });

    const imported = await syncWhoopRecoveryById("user-1", "sleep-uuid");

    expect(fetchSleepById).toHaveBeenCalledWith("tok", "sleep-uuid");
    expect(fetchRecoveryByCycleId).toHaveBeenCalledWith("tok", "991");
    expect(fetchErrorMock).not.toHaveBeenCalled();
    expect(imported).toBe(3);
    const rows = upsertMock.mock.calls[0][1] as Array<{ externalId: string }>;
    expect(rows.map((r) => r.externalId)).toEqual([
      "sleep-uuid:recovery",
      "sleep-uuid:hrv_rmssd",
      "sleep-uuid:rhr",
    ]);
  });

  it("imports nothing when the sleep carries no cycle id", async () => {
    fetchSleepById.mockResolvedValue({ id: "sleep-uuid" });

    expect(await syncWhoopRecoveryById("user-1", "sleep-uuid")).toBe(0);
    expect(fetchRecoveryByCycleId).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("routes a failed sleep read through the shared fetch-error path", async () => {
    const err = new Error("boom");
    fetchSleepById.mockRejectedValue(err);

    await syncWhoopRecoveryById("user-1", "sleep-uuid");
    expect(fetchErrorMock).toHaveBeenCalledWith("recovery", "user-1", err);
  });
});
