/**
 * Rows of an Apple Health import chunk that the account already holds with
 * exactly the values the import's update would write.
 *
 * A re-import of an export the account already holds sent one UPDATE per
 * row the insert skipped, about two million statements for a large export,
 * nearly all of them writing back what was stored. The import reads the
 * stored rows of a chunk once and leaves those out; it still counts them as
 * updated. A key that occurs twice in the chunk is never left out: its rows
 * are written in order, as before, so the last one stands.
 */
import type {
  MeasurementType,
  PrismaClient,
  SleepStage,
} from "@/generated/prisma/client";

export interface ImportUpdateRow {
  type: MeasurementType;
  externalId: string;
  value: number;
  measuredAt: Date;
  externalSourceVersion: string | null;
  sleepStage?: SleepStage | null;
  deviceType: string | null;
}

/** `type::externalId` of every row whose update would change nothing. */
export async function storedUnchangedKeys(
  db: Pick<PrismaClient, "measurement">,
  userId: string,
  chunk: readonly ImportUpdateRow[],
  /** Rows the chunk already settled (inserted, or failed to insert). */
  settled: (row: ImportUpdateRow, index: number) => boolean = () => false,
): Promise<Set<string>> {
  const out = new Set<string>();
  const rows = chunk.filter((row, index) => !settled(row, index));
  if (rows.length === 0) return out;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.type}::${row.externalId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const single = rows.filter(
    (row) => counts.get(`${row.type}::${row.externalId}`) === 1,
  );
  if (single.length === 0) return out;
  const stored = await db.measurement.findMany({
    where: {
      userId,
      source: "APPLE_HEALTH",
      externalId: { in: single.map((row) => row.externalId) },
    },
    select: {
      type: true,
      externalId: true,
      value: true,
      measuredAt: true,
      externalSourceVersion: true,
      sleepStage: true,
      deviceType: true,
    },
  });
  const byKey = new Map<string, (typeof stored)[number]>(
    stored.map((row) => [`${row.type}::${row.externalId}`, row]),
  );
  for (const row of single) {
    const key = `${row.type}::${row.externalId}`;
    const was = byKey.get(key);
    if (
      was &&
      was.value === row.value &&
      was.measuredAt.getTime() === row.measuredAt.getTime() &&
      (was.externalSourceVersion ?? null) ===
        (row.externalSourceVersion ?? null) &&
      (was.sleepStage ?? null) === (row.sleepStage ?? null) &&
      (was.deviceType ?? null) === (row.deviceType ?? null)
    ) {
      out.add(key);
    }
  }
  return out;
}

/**
 * The rescue when an imported row's update finds no row at its external id,
 * or collides on the natural identity: a skipped insert can mean another
 * external id holds the row's `(type, measuredAt, source, sleepStage)`.
 * Adopt that row in place, as the old upsert rescue did. Answers what
 * happened, as the import's per-type tally names it.
 */
export async function adoptNaturalKeyTwin(
  db: Pick<PrismaClient, "measurement">,
  userId: string,
  row: ImportUpdateRow & { unit: string },
): Promise<"updated" | "natural_key_unresolved" | "natural_key_rescue_failed"> {
  try {
    const twin = await db.measurement.findFirst({
      where: {
        userId,
        type: row.type,
        source: "APPLE_HEALTH",
        measuredAt: row.measuredAt,
        sleepStage: row.sleepStage ?? null,
      },
      select: { id: true },
    });
    if (!twin) return "natural_key_unresolved";
    await db.measurement.update({
      where: { id: twin.id },
      data: {
        value: row.value,
        unit: row.unit,
        externalId: row.externalId,
        externalSourceVersion: row.externalSourceVersion,
        deviceType: row.deviceType,
        deletedAt: null,
      },
    });
    return "updated";
  } catch {
    return "natural_key_rescue_failed";
  }
}
