/**
 * The nightly purge of expired tombstones for the soft-delete models the
 * retention register hands to `soft-delete-purge`.
 *
 * Proves, against the migrated schema: every table's purge statement runs; an
 * expired tombstone goes while a recent one and a live row stay; a purged
 * visit cascades its links and leaves a live vaccination that named it in
 * place; a start folded into a live cycle stays; the coach facts keep their
 * longer horizon.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TOMBSTONE_RETENTION_DAYS } from "@/lib/auth/native-client";
import {
  purgeModels,
  purgeSoftDeletedRows,
  purgeSoftDeletedTable,
} from "@/lib/jobs/soft-delete-retention";

import { getPrismaClient, truncateAllTables } from "./setup";

vi.mock("@/lib/db-compat", () => ({
  ensureDbCompatibility: vi.fn().mockResolvedValue(undefined),
}));

const USER = "soft-delete-purge-user";
const NOW = new Date("2026-10-20T03:42:00.000Z");
const DAY = 86_400_000;
const EXPIRED = new Date(NOW.getTime() - (TOMBSTONE_RETENTION_DAYS + 5) * DAY);
const RECENT = new Date(NOW.getTime() - 10 * DAY);

const prisma = getPrismaClient();

beforeEach(async () => {
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: { id: USER, username: USER, role: "USER", timezone: "UTC" },
  });
});

describe("soft-delete purge", () => {
  it("runs every table's purge against the real schema", async () => {
    const legs = await purgeSoftDeletedRows(prisma, NOW);
    expect(legs.map((leg) => leg.model)).toEqual(purgeModels());
    expect(legs.length).toBeGreaterThanOrEqual(19);
    for (const leg of legs) {
      expect(leg, leg.model).toMatchObject({ deleted: 0, drained: true });
    }
  });

  it("removes an expired tombstone and keeps a recent one and a live row", async () => {
    const lab = (id: string, deletedAt: Date | null) =>
      prisma.labResult.create({
        data: {
          id,
          userId: USER,
          analyte: "LDL",
          unit: "mg/dL",
          value: 100,
          takenAt: new Date("2026-01-01T08:00:00.000Z"),
          deletedAt,
        },
      });
    await lab("lab-expired", EXPIRED);
    await lab("lab-recent", RECENT);
    await lab("lab-live", null);

    const leg = await purgeSoftDeletedTable(prisma, "LabResult", NOW);

    expect(leg).toMatchObject({ deleted: 1, drained: true });
    const left = await prisma.labResult.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(left.map((r) => r.id)).toEqual(["lab-live", "lab-recent"]);
  });

  it("cascades a purged visit's links and unhooks a live vaccination", async () => {
    await prisma.encounter.create({
      data: {
        id: "visit-expired",
        userId: USER,
        occurredAt: new Date("2026-01-01T08:00:00.000Z"),
        deletedAt: EXPIRED,
      },
    });
    await prisma.vaccinationRecord.create({
      data: {
        id: "vacc-live",
        userId: USER,
        occurredAt: new Date("2026-01-01T08:00:00.000Z"),
        encounterId: "visit-expired",
      },
    });

    const leg = await purgeSoftDeletedTable(prisma, "Encounter", NOW);

    expect(leg.deleted).toBe(1);
    expect(await prisma.encounter.count()).toBe(0);
    expect(
      await prisma.vaccinationRecord.findUniqueOrThrow({
        where: { id: "vacc-live" },
        select: { encounterId: true, deletedAt: true },
      }),
    ).toEqual({ encounterId: null, deletedAt: null });
  });

  it("keeps a start folded into a live cycle until that cycle goes", async () => {
    const cycle = (
      id: string,
      startDate: string,
      deletedAt: Date | null,
      absorbedIntoId: string | null = null,
    ) =>
      prisma.menstrualCycle.create({
        data: { id, userId: USER, startDate, deletedAt, absorbedIntoId },
      });
    await cycle("cycle-live", "2026-01-01", null);
    await cycle("cycle-folded", "2026-01-03", EXPIRED, "cycle-live");
    await cycle("cycle-gone-absorber", "2025-12-01", EXPIRED);
    await cycle(
      "cycle-folded-orphan",
      "2025-12-03",
      EXPIRED,
      "cycle-gone-absorber",
    );
    await cycle("cycle-plain", "2025-11-01", EXPIRED);

    const leg = await purgeSoftDeletedTable(prisma, "MenstrualCycle", NOW);

    expect(leg.deleted).toBe(3);
    const left = await prisma.menstrualCycle.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(left.map((r) => r.id)).toEqual(["cycle-folded", "cycle-live"]);
  });

  it("keeps a removed coach fact for the coach message retention", async () => {
    const fact = (id: string, deletedAt: Date) =>
      prisma.coachFact.create({
        data: {
          id,
          userId: USER,
          category: "medication",
          factEncrypted: Buffer.from("opaque"),
          deletedAt,
        },
      });
    await fact("fact-past-sync-horizon", EXPIRED);
    await fact("fact-past-a-year", new Date(NOW.getTime() - 400 * DAY));

    const leg = await purgeSoftDeletedTable(prisma, "CoachFact", NOW);

    expect(leg.deleted).toBe(1);
    const left = await prisma.coachFact.findMany({ select: { id: true } });
    expect(left.map((r) => r.id)).toEqual(["fact-past-sync-horizon"]);
  });

  it("counter-check: refuses a model the register does not hand to it", async () => {
    await expect(
      purgeSoftDeletedTable(prisma, "Measurement", NOW),
    ).rejects.toThrow("No purge entry for Measurement");
  });
});
