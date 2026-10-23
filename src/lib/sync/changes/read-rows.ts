/**
 * The per-domain keyset walks of the delta feed.
 *
 * Live and soft-deleted rows come out of the same scan: a soft-delete bumps
 * `updatedAt`, so a tombstone is just a row whose `deletedAt` is non-null.
 * Each walk fetches `limit + 1` rows to detect `hasMore` without a count
 * query.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { DomainWatermark, SyncCursor } from "@/lib/sync/cursor";
import { dayLogSymptomInclude } from "@/lib/cycle/dto";

const MEASUREMENT_SELECT = {
  id: true,
  externalId: true,
  type: true,
  value: true,
  unit: true,
  measuredAt: true,
  source: true,
  notes: true,
  notesEncrypted: true,
  syncVersion: true,
  deletedAt: true,
  updatedAt: true,
} satisfies Prisma.MeasurementSelect;

const MOOD_SELECT = {
  id: true,
  date: true,
  mood: true,
  score: true,
  moodA1: true,
  stressA2: true,
  energyA3: true,
  connectionA4: true,
  stabilityA5: true,
  context: true,
  tags: true,
  note: true,
  noteEncrypted: true,
  moodLoggedAt: true,
  source: true,
  syncVersion: true,
  deletedAt: true,
  updatedAt: true,
} satisfies Prisma.MoodEntrySelect;

const INTAKE_SELECT = {
  id: true,
  medicationId: true,
  scheduledFor: true,
  takenAt: true,
  skipped: true,
  source: true,
  autoRecorded: true,
  syncVersion: true,
  deletedAt: true,
  updatedAt: true,
} satisfies Prisma.MedicationIntakeEventSelect;

export type MeasurementRow = Prisma.MeasurementGetPayload<{
  select: typeof MEASUREMENT_SELECT;
}>;
export type MoodRow = Prisma.MoodEntryGetPayload<{
  select: typeof MOOD_SELECT;
}>;
export type IntakeRow = Prisma.MedicationIntakeEventGetPayload<{
  select: typeof INTAKE_SELECT;
}>;
export type CycleDayRow = Prisma.CycleDayLogGetPayload<{
  include: typeof dayLogSymptomInclude;
}>;
export type CycleRow = Prisma.MenstrualCycleGetPayload<object>;

/**
 * Build the `(updatedAt, id)` keyset predicate for a domain's watermark.
 * Empty object (full scan) when the client has no watermark for it yet.
 */
function keysetFilter(wm: DomainWatermark | undefined) {
  if (!wm) return {};
  const at = new Date(wm.updatedAtMs);
  return {
    OR: [
      { updatedAt: { gt: at } },
      { AND: [{ updatedAt: at }, { id: { gt: wm.id } }] },
    ],
  };
}

export interface DomainRows {
  measurements: MeasurementRow[];
  mood: MoodRow[];
  intakes: IntakeRow[];
  cycleDays: CycleDayRow[];
  cycles: CycleRow[];
}

/**
 * Read one page plus one row of every domain past its watermark. The cycle
 * walks are skipped outright when the module is off, not filtered after the
 * fact, so the disabled rows are never read out of Postgres at all.
 */
export async function readDomainRows(
  userId: string,
  cursor: SyncCursor,
  limit: number,
  cycleEnabled: boolean,
): Promise<DomainRows> {
  const [measurements, mood, intakes, cycleDays, cycles] = await Promise.all([
    prisma.measurement.findMany({
      where: { userId, ...keysetFilter(cursor.measurements) },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: MEASUREMENT_SELECT,
    }),
    prisma.moodEntry.findMany({
      where: { userId, ...keysetFilter(cursor.mood) },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: MOOD_SELECT,
    }),
    prisma.medicationIntakeEvent.findMany({
      where: { userId, ...keysetFilter(cursor.intakes) },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: INTAKE_SELECT,
    }),
    cycleEnabled
      ? prisma.cycleDayLog.findMany({
          where: { userId, ...keysetFilter(cursor.cycleDays) },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take: limit + 1,
          include: dayLogSymptomInclude,
        })
      : [],
    cycleEnabled
      ? prisma.menstrualCycle.findMany({
          where: { userId, ...keysetFilter(cursor.cycles) },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take: limit + 1,
        })
      : [],
  ]);
  return { measurements, mood, intakes, cycleDays, cycles };
}
