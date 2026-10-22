/**
 * The family history, with both backup ends in one file.
 */
import { Buffer } from "node:buffer";

import type { PrismaClient } from "@/generated/prisma/client";
import { encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import {
  toFamilyHistoryEntryDTO,
  type FamilyHistoryEntryDTO,
} from "@/lib/records/dto";
import {
  decodeEncryptedBytes,
  type RestoreContext,
} from "@/lib/export/restore-context";

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * A family-history entry as the disaster-recovery file carries it: the note
 * as the ciphertext at rest, and the deletion. The portable file carries the
 * readable DTO of the live entries only.
 */
export type CanonicalFamilyHistoryEntry = FamilyHistoryEntryDTO & {
  notesEncrypted?: string | null;
  deletedAt?: string | null;
};

/**
 * The family-history slice of the records section. A disaster-recovery file
 * carries deleted entries too, as every other record with a tombstone does:
 * a restore from it has to give back the account as it was, deletions
 * included, and the file used to drop them.
 */
export async function buildFamilyHistoryBackupSlice(
  prisma: Pick<PrismaClient, "familyHistoryEntry">,
  userId: string,
  disasterRecovery: boolean,
): Promise<{ familyHistory: CanonicalFamilyHistoryEntry[] }> {
  const familyRows = await prisma.familyHistoryEntry.findMany({
    where: disasterRecovery ? { userId } : { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const familyHistory: CanonicalFamilyHistoryEntry[] = disasterRecovery
    ? familyRows.map((row) => ({
        id: row.id,
        relationship: row.relationship,
        condition: row.condition,
        ageAtOnset: row.ageAtOnset,
        note: null,
        notesEncrypted: row.notesEncrypted
          ? Buffer.from(row.notesEncrypted).toString("base64")
          : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt?.toISOString() ?? null,
      }))
    : familyRows.map(toFamilyHistoryEntryDTO);
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
        // The ciphertext verbatim when the file carries it, the readable note
        // sealed here otherwise.
        notesEncrypted:
          familyEntry.notesEncrypted !== undefined
            ? familyEntry.notesEncrypted === null
              ? null
              : decodeEncryptedBytes(familyEntry.notesEncrypted)
            : familyEntry.note == null
              ? null
              : encryptToBytes(familyEntry.note),
        deletedAt: familyEntry.deletedAt
          ? new Date(familyEntry.deletedAt)
          : null,
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
