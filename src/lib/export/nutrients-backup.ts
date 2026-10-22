/**
 * The nutrient day totals, with both backup ends in one file.
 */
import type { RestoreContext } from "@/lib/export/restore-context";

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
    })),
  });
}
