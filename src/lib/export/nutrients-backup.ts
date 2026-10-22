/**
 * The nutrient day totals, with both backup ends in one file.
 */
import type {
  BackupExportContext,
  BackupExportPart,
} from "@/lib/export/export-context";
import type { RestoreContext } from "@/lib/export/restore-context";

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * Nutrient day totals were absent from every export path, which contradicted
 * the schema's own reason for denormalising the unit column ("rows stay
 * self-describing in exports even if the catalog ever drifts"). `source` is
 * part of the composite PK, so it has to ride along or a restore cannot tell
 * a manual water entry from a synced day total. The table carries no
 * tombstone, so both purposes read the same shape. `externalSourceVersion`
 * is the source's own version marker, stored so the sync can replay it back
 * unchanged; `createdAt` is when the day first arrived. Neither can be
 * rebuilt after a restore.
 */
export async function buildNutrientsBackupPart(
  ctx: BackupExportContext,
): Promise<BackupExportPart> {
  const nutrientDays = await ctx.prisma.nutrientIntakeDay.findMany({
    where: { userId: ctx.userId },
    select: {
      day: true,
      nutrient: true,
      amount: true,
      unit: true,
      source: true,
      externalSourceVersion: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ day: "desc" }, { nutrient: "asc" }],
  });
  return {
    section: {
      nutrientDays: nutrientDays.map((n) => ({
        day: n.day,
        nutrient: n.nutrient,
        amount: n.amount,
        unit: n.unit,
        source: n.source,
        externalSourceVersion: n.externalSourceVersion,
        createdAt: n.createdAt.toISOString(),
        // The day's last write, for the disaster-recovery file, which gives
        // the account back as it was.
        ...(ctx.disasterRecovery
          ? { updatedAt: n.updatedAt.toISOString() }
          : {}),
      })),
    },
    counts: { nutrientDays: nutrientDays.length },
  };
}

// ── Restore ──────────────────────────────────────────────────────────────────

/**
 * The export has written nutrient day totals since v1.29 and nothing here
 * used to read them back: water and vitamin history was carried in the file,
 * discarded on restore, and the restore reported success.
 */
export async function clearNutrientDays(ctx: RestoreContext): Promise<void> {
  const nutrientDays = await ctx.tx.nutrientIntakeDay.deleteMany({
    where: { userId: ctx.ownerId },
  });
  ctx.cleared.nutrientDays = nutrientDays.count;
}

export async function restoreNutrientDays(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload } = ctx;
  if (payload.nutrientDays.length === 0) return;
  await tx.nutrientIntakeDay.createMany({
    data: payload.nutrientDays.map((n) => ({
      userId: ownerId,
      day: n.day,
      nutrient: n.nutrient,
      amount: n.amount,
      unit: n.unit,
      source: n.source,
      externalSourceVersion: n.externalSourceVersion ?? null,
      ...(n.createdAt ? { createdAt: new Date(n.createdAt) } : {}),
      ...(n.updatedAt ? { updatedAt: new Date(n.updatedAt) } : {}),
    })),
  });
}
