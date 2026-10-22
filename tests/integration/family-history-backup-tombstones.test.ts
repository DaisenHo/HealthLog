/**
 * The disaster-recovery file carries deleted family-history entries, as it
 * carries every other record's tombstones, and carries their note as the
 * ciphertext at rest. The portable file carries the live entries only, with
 * the note readable. The full round trip, the restored tombstone included, is
 * pinned by the backup parity golden copies.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import { buildFamilyHistoryBackupSlice } from "@/lib/export/family-history-backup";

import { makeUser } from "../kit/factories";
import { getPrismaClient, truncateAllTables } from "./setup";

const prisma = getPrismaClient();

beforeEach(() => truncateAllTables(prisma));

describe("family history in the backup", () => {
  it("keeps a deleted entry in the disaster-recovery file and out of the portable one", async () => {
    const user = await makeUser();
    const notes = encryptToBytes("diagnosed at fifty");
    await prisma.familyHistoryEntry.create({
      data: { userId: user.id, relationship: "MOTHER", condition: "Asthma" },
    });
    const deleted = await prisma.familyHistoryEntry.create({
      data: {
        userId: user.id,
        relationship: "FATHER",
        condition: "Hypertension",
        notesEncrypted: notes,
        deletedAt: new Date("2026-09-30T10:00:00.000Z"),
      },
    });

    const dr = await buildFamilyHistoryBackupSlice(prisma, user.id, true);
    expect(dr.familyHistory).toHaveLength(2);
    const tombstone = dr.familyHistory.find((e) => e.id === deleted.id);
    expect(tombstone?.deletedAt).toBe("2026-09-30T10:00:00.000Z");
    expect(tombstone?.note).toBeNull();
    expect(tombstone?.notesEncrypted).toBe(
      Buffer.from(notes).toString("base64"),
    );

    const portable = await buildFamilyHistoryBackupSlice(
      prisma,
      user.id,
      false,
    );
    expect(portable.familyHistory.map((e) => e.condition)).toEqual(["Asthma"]);
  });
});
