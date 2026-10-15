/**
 * #1220 — every admitted full-history import runs inside its own background
 * event, so what the provider walk records on the ambient event (each
 * request with its status, every warning, every annotation) reaches the log.
 * Before, the drain ran the import with no event in scope, every one of those
 * calls was a no-op, and a failing backfill left nothing but its error
 * message behind.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";

import type { WideEvent } from "@/lib/logging/types";

const { emitted, runGoogleHealthBackfillMock } = vi.hoisted(() => ({
  emitted: [] as WideEvent[],
  runGoogleHealthBackfillMock: vi.fn(),
}));

vi.mock("@/lib/logging/transports", () => ({
  emitIfSampled: (event: WideEvent) => emitted.push(event),
}));
vi.mock("@/lib/jobs/integration-backfill-lock", () => ({
  withIntegrationBackfillLock: async (_id: string, run: () => unknown) => ({
    ran: true,
    result: await run(),
  }),
}));
vi.mock("@/lib/jobs/google-health-backfill", () => ({
  runGoogleHealthBackfillForUser: runGoogleHealthBackfillMock,
}));
vi.mock("@/lib/jobs/reminder/shared", () => ({ workerLog: () => {} }));

import { drainIntegrationBackfillAdmission } from "../integration-backfill-drain";
import type { IntegrationBackfillAdmissionPayload } from "../integration-backfill-admission";
import { annotate, getEvent } from "@/lib/logging/context";

function job(
  data: IntegrationBackfillAdmissionPayload,
): Job<IntegrationBackfillAdmissionPayload> {
  return {
    id: "job-1",
    data,
    expireInSeconds: 3600,
  } as unknown as Job<IntegrationBackfillAdmissionPayload>;
}

const payload: IntegrationBackfillAdmissionPayload = {
  kind: "google-health-backfill",
  data: { userId: "u1", enqueuedAt: "2026-10-14T11:00:00Z", slice: 2 },
};

beforeEach(() => {
  emitted.length = 0;
  runGoogleHealthBackfillMock.mockReset();
});

describe("drainIntegrationBackfillAdmission — one event per admitted run", () => {
  it("emits what the import recorded, with the job it belongs to", async () => {
    runGoogleHealthBackfillMock.mockImplementation(async () => {
      getEvent()?.addExternalCall({
        service: "google-health",
        method: "fetchHeartRate(page=0)",
        duration_ms: 120,
        status: 200,
      });
      annotate({ meta: { "googleHealth.backfill.slice": { pages: 1 } } });
      return { imported: 1000, continued: true };
    });

    await drainIntegrationBackfillAdmission([job(payload)]);

    expect(emitted).toHaveLength(1);
    const [event] = emitted;
    expect(event!.background).toMatchObject({
      task_name: "job.integration_backfill",
      result: { kind: "google-health-backfill", imported: 1000, continued: 1 },
    });
    expect(event!.meta).toMatchObject({
      kind: "google-health-backfill",
      identity: "google-health-backfill|u1",
      job_id: "job-1",
      slice: 2,
      "googleHealth.backfill.slice": { pages: 1 },
    });
    expect(event!.external_calls).toEqual([
      expect.objectContaining({
        method: "fetchHeartRate(page=0)",
        status: 200,
      }),
    ]);
  });

  it("emits the calls of a run that throws, with its error", async () => {
    runGoogleHealthBackfillMock.mockImplementation(async () => {
      getEvent()?.addExternalCall({
        service: "google-health",
        method: "fetchHeartRate(page=812)",
        duration_ms: 15000,
        status: 503,
        error: "transient HTTP 503",
      });
      throw new Error("google-health backfill incomplete for user u1");
    });

    await expect(
      drainIntegrationBackfillAdmission([job(payload)]),
    ).rejects.toThrow(/incomplete/);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.level).toBe("error");
    expect(emitted[0]!.error?.message).toMatch(/incomplete/);
    expect(emitted[0]!.external_calls?.[0]).toMatchObject({
      method: "fetchHeartRate(page=812)",
      status: 503,
    });
  });
});
