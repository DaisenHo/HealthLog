/**
 * v1.16.10 — inventory refunds in the intake-slot dedup pass.
 *
 * Collapsing a duplicate slot soft-deletes the loser rows. A loser that
 * carries a consumption stamp is a REAL taken row whose units left the
 * stock — tombstoning it without a refund would strand those units
 * forever (the row is no longer reachable through any user-facing
 * restore path). The dedup therefore refunds every stamped loser before
 * the tombstone; unstamped losers (pending / skipped / pre-stamp rows)
 * never consumed and are swept without a refund round-trip. The winner
 * keeps its own stamp untouched.
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
vi.mock("@/lib/cache/invalidate", () => ({
  invalidateUserMedications: vi.fn(),
}));
vi.mock("@/lib/medications/inventory/consumption", () => ({
  restoreForIntake: vi.fn().mockResolvedValue(undefined),
}));

import { dedupeUserIntakeSlots } from "../intake-slot-dedup";
import { restoreForIntake } from "@/lib/medications/inventory/consumption";
import { prisma } from "@/lib/db";

const TZ = "Europe/Berlin";

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

describe("dedupeUserIntakeSlots — inventory refunds (v1.16.10)", () => {
  it("refunds a stamped loser before tombstoning; the winner keeps its stamp", async () => {
    // 07:00 CEST = 05:00Z. Two TAKEN rows for the same dose — the iOS
    // drift duplicate (+30 s) beside the server row. The fresher row
    // (higher syncVersion) wins; the stamped loser must be refunded.
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      {
        id: "r-loser",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:00.000Z"),
        takenAt: new Date("2026-06-15T05:01:00.000Z"),
        skipped: false,
        syncVersion: 0,
        createdAt: new Date("2026-06-15T05:01:00Z"),
        attributionSource: "AUTO",
        source: "WEB",
        inventoryConsumption: [{ itemId: "item-1", units: 2 }],
      },
      {
        id: "r-winner",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:30.000Z"),
        takenAt: new Date("2026-06-15T05:01:30.000Z"),
        skipped: false,
        syncVersion: 3,
        createdAt: new Date("2026-06-15T05:01:30Z"),
        attributionSource: "AUTO",
        source: "API",
        inventoryConsumption: [{ itemId: "item-1", units: 2 }],
      },
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");
    expect(summary.slotsCollapsed).toBe(1);
    expect(summary.rowsSoftDeleted).toBe(1);

    // Only the LOSER is refunded — the winner keeps its stamp.
    expect(restoreForIntake).toHaveBeenCalledTimes(1);
    expect(restoreForIntake).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", eventId: "r-loser" }),
    );

    // The refund runs before the loser tombstone sweep.
    const restoreOrder =
      vi.mocked(restoreForIntake).mock.invocationCallOrder[0];
    const sweepOrder = vi.mocked(prisma.medicationIntakeEvent.updateMany).mock
      .invocationCallOrder[0];
    expect(restoreOrder).toBeLessThan(sweepOrder);
  });

  it("ignores unstamped losers (a pending sibling never consumed)", async () => {
    vi.mocked(prisma.medicationIntakeEvent.findMany).mockResolvedValue([
      {
        id: "r-taken",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:00.000Z"),
        takenAt: new Date("2026-06-15T05:01:00.000Z"),
        skipped: false,
        syncVersion: 1,
        createdAt: new Date("2026-06-15T05:01:00Z"),
        attributionSource: "AUTO",
        source: "WEB",
        inventoryConsumption: [{ itemId: "item-1", units: 1 }],
      },
      {
        id: "r-pending",
        medicationId: "med-1",
        scheduledFor: new Date("2026-06-15T05:00:30.000Z"),
        takenAt: null,
        skipped: false,
        syncVersion: 0,
        createdAt: new Date("2026-06-15T04:00:00Z"),
        attributionSource: "AUTO",
        source: "REMINDER",
        inventoryConsumption: null,
      },
    ] as never);

    const summary = await dedupeUserIntakeSlots("u1");
    expect(summary.slotsCollapsed).toBe(1);
    expect(summary.rowsSoftDeleted).toBe(1);
    // The taken row wins; the pending loser carries no stamp → no refund.
    expect(restoreForIntake).not.toHaveBeenCalled();
  });
});
