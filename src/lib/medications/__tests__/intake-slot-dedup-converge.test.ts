/**
 * v1.16.9 — ad-hoc→pending band convergence in the nightly dedup.
 *
 * The production damage this heals: the external-API and Telegram write
 * paths historically bare-created `scheduledFor = takenAt`, leaving the
 * worker-minted pending REMINDER row open. The legacy snap pass only
 * reaches a ± half-window tolerance and the discovery query only matched
 * 2-minute drift, so an 08:42 API take beside its pending 09:00 row
 * never collapsed — the ledger showed an ad-hoc take PLUS a missed slot
 * for one real dose.
 *
 * Covered here:
 *   1. The 08:42 / 09:00 pair heals: the pending row tombstones, the
 *      take normalises onto the canonical anchor.
 *   2. A take outside the legacy snap tolerance but inside the band's
 *      late tail still heals (the case the snap pass can never reach).
 *   3. An ambiguous double-slot (two live rows on the anchor) is left
 *      alone by the convergence pass.
 *   4. A WEB ad-hoc row (deliberate user shape) is never converged.
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

// Daily 09:00 Berlin med. 09:00 CEST on 2026-06-10 = 07:00:00Z.
const SLOT_0900 = new Date("2026-06-10T07:00:00.000Z");
const TAKEN_0842 = new Date("2026-06-10T06:42:00.000Z");
// 12:30 Berlin — outside the ±2h legacy snap tolerance of the 09:00
// anchor, but inside the band's late tail (on-time end 10:00 + 180 min).
const TAKEN_1230 = new Date("2026-06-10T10:30:00.000Z");

const SCHEDULE = {
  id: "s1",
  windowStart: "09:00",
  windowEnd: "09:00",
  daysOfWeek: null,
  timesOfDay: ["09:00"],
  reminderGraceMinutes: null,
  rrule: "FREQ=DAILY",
  rollingIntervalDays: null,
  scheduleType: "SCHEDULED",
  cyclicOnWeeks: null,
  cyclicOffWeeks: null,
  doseWindows: null,
};

const MED = {
  id: "med-1",
  userId: "u1",
  startsOn: null,
  endsOn: null,
  oneShot: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  schedules: [SCHEDULE],
  scheduleRevisions: [],
};

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: "r-pending",
    medicationId: "med-1",
    scheduledFor: SLOT_0900,
    takenAt: null,
    skipped: false,
    syncVersion: 0,
    createdAt: new Date("2026-06-10T05:00:00Z"),
    attributionSource: "AUTO",
    source: "REMINDER",
    ...over,
  };
}

function adhocRow(at: Date, over: Record<string, unknown> = {}) {
  return {
    id: "r-adhoc",
    medicationId: "med-1",
    scheduledFor: at,
    takenAt: at,
    skipped: false,
    syncVersion: 1,
    createdAt: at,
    attributionSource: "AUTO",
    source: "API",
    ...over,
  };
}

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

describe("dedupeUserIntakeSlots — ad-hoc→pending convergence (v1.16.9)", () => {
  it("heals the 08:42 API take / pending 09:00 REMINDER pair", async () => {
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      adhocRow(TAKEN_0842),
      pendingRow(),
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    // The pending row tombstones; the take is the dose of record.
    expect(prisma.medicationIntakeEvent.updateMany).toHaveBeenCalledTimes(1);
    const tombstone = vi.mocked(prisma.medicationIntakeEvent.updateMany).mock
      .calls[0][0] as {
      where: { id: string };
      data: { deletedAt: Date };
    };
    expect(tombstone.where.id).toBe("r-pending");
    expect(tombstone.data.deletedAt).toBeInstanceOf(Date);

    // The take normalises onto the canonical 09:00 anchor.
    expect(prisma.medicationIntakeEvent.update).toHaveBeenCalledTimes(1);
    const normalise = vi.mocked(prisma.medicationIntakeEvent.update).mock
      .calls[0][0] as {
      where: { id: string };
      data: { scheduledFor: Date };
    };
    expect(normalise.where.id).toBe("r-adhoc");
    expect(normalise.data.scheduledFor.getTime()).toBe(SLOT_0900.getTime());

    expect(summary.rowsSoftDeleted).toBe(1);
    expect(summary.rowsNormalised).toBe(1);
    expect(summary.slotsCollapsed).toBe(1);
    expect(summary.daysRecomputed).toBeGreaterThanOrEqual(1);
  });

  it("heals an early take ahead of an explicit window that starts AT the dose time", async () => {
    // Explicit 09:00–10:00 dose window: the on-time band starts AT the
    // dose time, so an 08:42 take sits only inside the bounded early
    // grace below `onTimeStart`. The convergence must accept it exactly
    // like the write-path attribution does — otherwise the actioned
    // ad-hoc row stays beside the unactioned 09:00 REMINDER row and the
    // slot later auto-misses a dose the user took.
    vi.mocked(prisma.medication.findMany).mockResolvedValue([
      {
        ...MED,
        schedules: [
          {
            ...SCHEDULE,
            windowStart: "09:00",
            windowEnd: "10:00",
            doseWindows: [{ timeOfDay: "09:00", start: "09:00", end: "10:00" }],
          },
        ],
      },
    ] as never);
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      adhocRow(TAKEN_0842),
      pendingRow(),
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    const tombstone = vi.mocked(prisma.medicationIntakeEvent.updateMany).mock
      .calls[0][0] as { where: { id: string } };
    expect(tombstone.where.id).toBe("r-pending");
    const normalise = vi.mocked(prisma.medicationIntakeEvent.update).mock
      .calls[0][0] as { where: { id: string }; data: { scheduledFor: Date } };
    expect(normalise.where.id).toBe("r-adhoc");
    expect(normalise.data.scheduledFor.getTime()).toBe(SLOT_0900.getTime());
    expect(summary.slotsCollapsed).toBe(1);
  });

  it("heals a take outside the legacy snap tolerance but inside the band's late tail", async () => {
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      adhocRow(TAKEN_1230),
      pendingRow(),
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    expect(summary.rowsSoftDeleted).toBe(1);
    expect(summary.rowsNormalised).toBe(1);
    const tombstone = vi.mocked(prisma.medicationIntakeEvent.updateMany).mock
      .calls[0][0] as { where: { id: string } };
    expect(tombstone.where.id).toBe("r-pending");
    const normalise = vi.mocked(prisma.medicationIntakeEvent.update).mock
      .calls[0][0] as { where: { id: string }; data: { scheduledFor: Date } };
    expect(normalise.where.id).toBe("r-adhoc");
    expect(normalise.data.scheduledFor.getTime()).toBe(SLOT_0900.getTime());
  });

  it("leaves an ambiguous double-slot (two live rows on the anchor) alone", async () => {
    // Two live rows already sit on the 09:00 anchor — converging the take
    // would have to pick one blindly. The convergence pass declines; the
    // take stays where it is. (The legacy exact-instant collapse of the
    // two anchor rows is a separate, pre-existing pass.)
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      adhocRow(TAKEN_1230),
      pendingRow(),
      pendingRow({ id: "r-pending-2", source: "API" }),
    ] as never);

    await dedupeUserIntakeSlots("u1");

    // The ad-hoc take was never normalised onto the anchor.
    const normaliseCalls = vi
      .mocked(prisma.medicationIntakeEvent.update)
      .mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id);
    expect(normaliseCalls).not.toContain("r-adhoc");
  });

  it("never converges a WEB ad-hoc row (deliberate user shape)", async () => {
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      adhocRow(TAKEN_1230, { source: "WEB" }),
      pendingRow(),
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    expect(summary.rowsSoftDeleted).toBe(0);
    expect(summary.rowsNormalised).toBe(0);
    expect(prisma.medicationIntakeEvent.updateMany).not.toHaveBeenCalled();
    expect(prisma.medicationIntakeEvent.update).not.toHaveBeenCalled();
  });

  it("never converges a USER_PIN released row", async () => {
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      adhocRow(TAKEN_1230, { attributionSource: "USER_PIN" }),
      pendingRow(),
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");

    expect(summary.rowsSoftDeleted).toBe(0);
    expect(prisma.medicationIntakeEvent.updateMany).not.toHaveBeenCalled();
  });
});
