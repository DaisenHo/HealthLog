/**
 * The allergy record, with both backup ends in one file.
 */
import { Buffer } from "node:buffer";

import type { PrismaClient } from "@/generated/prisma/client";
import { encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import { toAllergyDTO, type AllergyDTO } from "@/lib/records/dto";
import {
  decodeEncryptedBytes,
  type RestoreContext,
} from "@/lib/export/restore-context";

// ── Export ───────────────────────────────────────────────────────────────────

export type CanonicalAllergy = AllergyDTO & {
  reactionEncrypted?: string | null;
  notesEncrypted?: string | null;
  deletedAt?: string | null;
};

/** The allergy slice of the records section. */
export async function buildAllergiesBackupSlice(
  prisma: Pick<PrismaClient, "allergy">,
  userId: string,
  disasterRecovery: boolean,
): Promise<{ allergies: CanonicalAllergy[] }> {
  const allergyRows = await prisma.allergy.findMany({
    where: disasterRecovery ? { userId } : { userId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const allergies: CanonicalAllergy[] = disasterRecovery
    ? allergyRows.map((row) => ({
        id: row.id,
        substance: row.substance,
        category: row.category,
        type: row.type,
        severity: row.severity,
        status: row.status,
        onsetAt: row.onsetAt?.toISOString() ?? null,
        reaction: null,
        note: null,
        reactionEncrypted: row.reactionEncrypted
          ? Buffer.from(row.reactionEncrypted).toString("base64")
          : null,
        notesEncrypted: row.notesEncrypted
          ? Buffer.from(row.notesEncrypted).toString("base64")
          : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt?.toISOString() ?? null,
      }))
    : allergyRows.map(toAllergyDTO);
  return { allergies };
}

// ── Restore ──────────────────────────────────────────────────────────────────

export async function clearAllergies(ctx: RestoreContext): Promise<void> {
  const allergies = await ctx.tx.allergy.deleteMany({
    where: { userId: ctx.ownerId },
  });
  ctx.cleared.allergies = allergies.count;
}

/** Each free-text column: ciphertext verbatim, or plaintext sealed here. */
export async function restoreAllergies(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload } = ctx;
  ctx.reportSection("allergies");
  for (const allergy of payload.allergies) {
    await tx.allergy.create({
      data: {
        id: allergy.id,
        userId: ownerId,
        substance: allergy.substance,
        category: allergy.category as never,
        type: allergy.type as never,
        severity: (allergy.severity ?? null) as never,
        status: allergy.status as never,
        onsetAt: allergy.onsetAt ? new Date(allergy.onsetAt) : null,
        reactionEncrypted:
          allergy.reactionEncrypted !== undefined
            ? allergy.reactionEncrypted === null
              ? null
              : decodeEncryptedBytes(allergy.reactionEncrypted)
            : allergy.reaction == null
              ? null
              : encryptToBytes(allergy.reaction),
        notesEncrypted:
          allergy.notesEncrypted !== undefined
            ? allergy.notesEncrypted === null
              ? null
              : decodeEncryptedBytes(allergy.notesEncrypted)
            : allergy.note == null
              ? null
              : encryptToBytes(allergy.note),
        deletedAt: allergy.deletedAt ? new Date(allergy.deletedAt) : null,
        ...(allergy.createdAt
          ? { createdAt: new Date(allergy.createdAt) }
          : {}),
        ...(allergy.updatedAt
          ? { updatedAt: new Date(allergy.updatedAt) }
          : {}),
      },
    });
  }
}
