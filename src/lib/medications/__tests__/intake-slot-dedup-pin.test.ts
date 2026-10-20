/**
 * v1.16.0 — pin-awareness of the intake-slot dedup pass.
 *
 * The exclusion is keyed on the PERSISTED provenance
 * (`attributionSource = USER_PIN`), never on the `scheduledFor === takenAt`
 * row shape: since v1.15.19 every AUTO standalone insert anchors
 * `scheduledFor = takenAt`, so a shape-based guard would also shield the
 * legitimate drift duplicates (an iOS row +60 s beside the server pending
 * row) the dedup exists to collapse.
 *
 * Covered here:
 *
 *   1. The nightly re-pin scenario: the user releases a binding
 *      ("Zuordnung lösen" → the row keeps USER_PIN with
 *      `scheduledFor === takenAt`), the projector re-mints a pending row on
 *      the freed slot, then the dedup cron runs. The released row must stay
 *      standalone and the pending row must survive untouched (free to
 *      auto-miss normally) — the snap's legacy ± half-window tolerance is
 *      WIDER than the band model and would otherwise re-merge the pair,
 *      silently reverting the user's decision.
 *
 *   2. The regression guard: an AUTO standalone take with the
 *      `scheduledFor === takenAt` anchor shape and sub-minute drift IS
 *      still collapsed into the slot's cluster.
 *
 *   3. A USER_PIN row sharing its exact slot anchor with an AUTO sibling
 *      (cross-source race) is left alone: the pin never enters the
 *      cluster, so nothing is soft-deleted — declining to collapse never
 *      destroys a dose record.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    medication: { findMany: vi.fn() },
    medicationIntakeEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/jobs/boss-instance", () => ({ getGlobalBoss: vi.fn() }));
vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("@/lib/medications/dose-day-refresh", () => ({
  refreshDoseSlot: vi.fn().mockResolvedValue(undefined),
}));

import { dedupeUserIntakeSlots } from "../intake-slot-dedup";
import { prisma } from "@/lib/db";

const TZ = "Europe/Berlin";

// A daily 07:00 / 19:00 SCHEDULED med — same shape as the isolation test.
const SCHEDULE = {
  id: "s1",
  windowStart: "07:00",
  windowEnd: "07:00",
  daysOfWeek: null,
  timesOfDay: ["07:00", "19:00"],
  reminderGraceMinutes: null,
  rrule: null,
  rollingIntervalDays: null,
  scheduleType: "SCHEDULED",
  cyclicOnWeeks: null,
  cyclicOffWeeks: null,
};

const MED = {
  id: "med-1",
  userId: "u1",
  startsOn: null,
  endsOn: null,
  oneShot: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  schedules: [SCHEDULE],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    timezone: TZ,
  } as never);
  vi.mocked(prisma.medication.findMany).mockResolvedValue([MED] as never);
  vi.mocked(prisma.medicationIntakeEvent.findFirst).mockResolvedValue(
    null as never,
  );
  vi.mocked(prisma.medicationIntakeEvent.updateMany).mockResolvedValue({
    count: 1,
  } as never);
  vi.mocked(prisma.medicationIntakeEvent.update).mockResolvedValue({} as never);
});

describe("dedupeUserIntakeSlots — pin-awareness (v1.16.0)", () => {
  it("re-pin scenario: a released USER_PIN row stays standalone next to the re-minted pending", async () => {
    // 07:00 CEST = 05:00Z. The user released a binding: the take keeps
    // USER_PIN with `scheduledFor === takenAt` 40 min past the anchor —
    // inside the legacy snap tolerance. The projector then re-minted a
    // pending row on the freed 05:00Z slot.
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      {
        id: "r-07-pending",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:00.000Z"),
        takenAt: null,
        skipped: false,
        syncVersion: 0,
        createdAt: new Date("2026-06-15T06:00:00Z"),
        attributionSource: "AUTO",
      },
      {
        id: "r-07-released",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:40:00.000Z"),
        takenAt: new Date("2026-06-15T05:40:00.000Z"),
        skipped: false,
        syncVersion: 3,
        createdAt: new Date("2026-06-15T05:40:00Z"),
        attributionSource: "USER_PIN",
      },
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    // The released row never joins the 05:00 cluster → the slot holds one
    // row (the fresh pending) → nothing collapses; the pending survives to
    // auto-miss / be taken normally.
    expect(summary.slotsCollapsed).toBe(0);
    expect(summary.rowsSoftDeleted).toBe(0);
    expect(prisma.medicationIntakeEvent.updateMany).not.toHaveBeenCalled();
    expect(prisma.medicationIntakeEvent.update).not.toHaveBeenCalled();
  });

  it("still collapses an AUTO drift duplicate despite its scheduledFor === takenAt anchor shape", async () => {
    // The v1.15.19 standalone-insert anchor shape: the iOS take landed
    // +60 s beside the server-minted pending row, provenance AUTO. This is
    // exactly the duplicate the dedup exists for — the persisted-provenance
    // exclusion must NOT shield it the way the old shape heuristic did.
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      {
        id: "r-07-pending",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:00.000Z"),
        takenAt: null,
        skipped: false,
        syncVersion: 0,
        createdAt: new Date("2026-06-15T00:00:00Z"),
        attributionSource: "AUTO",
      },
      {
        id: "r-07-drift",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:01:00.000Z"),
        takenAt: new Date("2026-06-15T05:01:00.000Z"),
        skipped: false,
        syncVersion: 2,
        createdAt: new Date("2026-06-15T05:01:00Z"),
        attributionSource: "AUTO",
      },
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    // The pair collapses onto the taken row; the pending is the loser.
    expect(summary.slotsCollapsed).toBe(1);
    expect(summary.rowsSoftDeleted).toBe(1);
    const updateManyArg = vi.mocked(prisma.medicationIntakeEvent.updateMany)
      .mock.calls[0][0] as { where: { id: { in: string[] } } };
    expect(updateManyArg.where.id.in).toEqual(["r-07-pending"]);
  });

  it("leaves a USER_PIN row and its same-anchor AUTO sibling both alive (no collapse)", async () => {
    // Cross-source race shape: both rows sit on the 05:00Z anchor. The pin
    // never enters the cluster, so the cluster holds one row and nothing
    // is soft-deleted — neither dose record is destroyed.
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      {
        id: "r-07-pin",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:00.000Z"),
        takenAt: new Date("2026-06-15T09:30:00.000Z"),
        skipped: false,
        syncVersion: 1,
        createdAt: new Date("2026-06-15T05:00:00Z"),
        attributionSource: "USER_PIN",
      },
      {
        id: "r-07-auto",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:00.000Z"),
        takenAt: new Date("2026-06-15T05:05:00.000Z"),
        skipped: false,
        syncVersion: 7,
        createdAt: new Date("2026-06-15T05:01:00Z"),
        attributionSource: "AUTO",
      },
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    expect(summary.slotsCollapsed).toBe(0);
    expect(summary.rowsSoftDeleted).toBe(0);
    expect(prisma.medicationIntakeEvent.updateMany).not.toHaveBeenCalled();
  });
});
