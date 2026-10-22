/**
 * The family history, with both backup ends in one file.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import {
  toFamilyHistoryEntryDTO,
  type FamilyHistoryEntryDTO,
} from "@/lib/records/dto";
import type { RestoreContext } from "@/lib/export/restore-context";

// ── Export ───────────────────────────────────────────────────────────────────

/** The family-history slice of the records section. */
export async function buildFamilyHistoryBackupSlice(
  prisma: Pick<PrismaClient, "familyHistoryEntry">,
  userId: string,
): Promise<{ familyHistory: FamilyHistoryEntryDTO[] }> {
  const familyRows = await prisma.familyHistoryEntry.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const familyHistory = familyRows.map(toFamilyHistoryEntryDTO);
  return { familyHistory };
}

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
