/**
 * The family history, with both backup ends in one file.
 */
import { encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import type { RestoreContext } from "@/lib/export/restore-context";

// ── Restore ──────────────────────────────────────────────────────────────────

export async function clearFamilyHistory(ctx: RestoreContext): Promise<void> {
  const familyHistory = await ctx.tx.familyHistoryEntry.deleteMany({
    where: { userId: ctx.ownerId },
  });
  ctx.cleared.familyHistory = familyHistory.count;
}

export async function restoreFamilyHistory(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload } = ctx;
  ctx.reportSection("familyHistory");
  for (const familyEntry of payload.familyHistory) {
    await tx.familyHistoryEntry.create({
      data: {
        id: familyEntry.id,
        userId: ownerId,
        relationship: familyEntry.relationship as never,
        condition: familyEntry.condition,
        ageAtOnset: familyEntry.ageAtOnset ?? null,
        notesEncrypted:
          familyEntry.note == null ? null : encryptToBytes(familyEntry.note),
        ...(familyEntry.createdAt
          ? { createdAt: new Date(familyEntry.createdAt) }
          : {}),
        ...(familyEntry.updatedAt
          ? { updatedAt: new Date(familyEntry.updatedAt) }
          : {}),
      },
    });
  }
}
