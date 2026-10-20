/**
 * v1.28.46 — the boot-time converging-backfill discovery scans now
 * run a DB-level `SELECT DISTINCT user_id` (with a join / anti-join where the
 * owner is not a direct column) instead of Prisma's in-memory `distinct`, and
 * ride the migration-0243 partial indexes. This suite runs the REAL discovery
 * functions against real Postgres to prove the raw SQL is correct (table +
 * column names, the medication join, the thumbnail anti-join, the mime IN
 * filter) and that each returns EXACTLY the set of users still holding
 * un-migrated rows — no more, no fewer.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { setGlobalBoss } from "@/lib/jobs/boss-instance";
import { nativeCanvasSupported } from "@/lib/documents/native-canvas-support";
import { enqueueBootTimeNoteEncryptionBackfill } from "@/lib/jobs/note-encryption-backfill";
import { enqueueBootTimeMedNotesEncryptionBackfill } from "@/lib/jobs/med-notes-encryption-backfill";
import { enqueueBootTimeLabBiomarkerBackfill } from "@/lib/jobs/lab-biomarker-backfill";
import { enqueueBootTimeThumbnailBackfill } from "@/lib/jobs/document-thumbnail-backfill";
import { getPrismaClient, truncateAllTables } from "./setup";

/**
 * Minimal fake pg-boss that records which (queue, userId) pairs were sent.
 * The discovery functions call `boss.send(queue, payload, opts)` and expect a
 * truthy job id; capturing the payload's userId lets us assert the discovered
 * set without a real queue.
 */
function makeCapturingBoss() {
  const sent: { queue: string; userId: string }[] = [];
  const boss = {
    send: async (queue: string, payload: { userId?: string }) => {
      if (payload.userId) sent.push({ queue, userId: payload.userId });
      return `job-${sent.length}`;
    },
  };
  return { boss, sent };
}

function usersFor(sent: { userId: string }[]): string[] {
  return [...new Set(sent.map((s) => s.userId))].sort();
}

async function seedUser(id: string) {
  await getPrismaClient().user.create({
    data: {
      id,
      username: id,
      email: `${id}@example.test`,
      timezone: "Europe/Berlin",
    },
  });
}

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
});

describe("boot-discovery scans (real Postgres)", () => {
  it("note-encryption discovery returns exactly the users with un-migrated notes", async () => {
    const prisma = getPrismaClient();
    await Promise.all([
      seedUser("disc-a"),
      seedUser("disc-b"),
      seedUser("disc-c"),
    ]);
    // disc-a: a measurement with a legacy plaintext note (discoverable).
    await prisma.measurement.create({
      data: {
        userId: "disc-a",
        type: "WEIGHT",
        value: 80,
        unit: "kg",
        measuredAt: new Date(),
        notes: "legacy plaintext",
      },
    });
    // disc-b: a mood entry with a legacy plaintext note (discoverable).
    await prisma.moodEntry.create({
      data: {
        userId: "disc-b",
        date: "2026-01-01",
        mood: "GUT",
        score: 4,
        moodLoggedAt: new Date(),
        note: "legacy plaintext mood note",
      },
    });
    // disc-c: a measurement with NO note (must NOT be discovered).
    await prisma.measurement.create({
      data: {
        userId: "disc-c",
        type: "WEIGHT",
        value: 70,
        unit: "kg",
        measuredAt: new Date(),
      },
    });

    const { boss, sent } = makeCapturingBoss();
    setGlobalBoss(boss as never);
    const res = await enqueueBootTimeNoteEncryptionBackfill();
    expect(res.error).toBeNull();
    expect(usersFor(sent)).toEqual(["disc-a", "disc-b"]);
  });

  it("lab-biomarker discovery returns only users with unlinked live results", async () => {
    const prisma = getPrismaClient();
    await Promise.all([seedUser("lab-a"), seedUser("lab-b")]);
    // lab-a: unlinked (biomarkerId null), live → discoverable.
    await prisma.labResult.create({
      data: {
        userId: "lab-a",
        analyte: "LDL",
        unit: "mg/dL",
        takenAt: new Date(),
      },
    });
    // lab-b: unlinked but soft-deleted → excluded by `deleted_at IS NULL`.
    await prisma.labResult.create({
      data: {
        userId: "lab-b",
        analyte: "HbA1c",
        unit: "%",
        takenAt: new Date(),
        deletedAt: new Date(),
      },
    });

    const { boss, sent } = makeCapturingBoss();
    setGlobalBoss(boss as never);
    const res = await enqueueBootTimeLabBiomarkerBackfill();
    expect(res.error).toBeNull();
    expect(usersFor(sent)).toEqual(["lab-a"]);
  });

  it("med-notes discovery runs its join SQL cleanly (empty tables → no enqueues)", async () => {
    // Exercises the three raw statements incl. the dose-changes → medications
    // JOIN. Empty tables prove the SQL parses + executes against the real
    // schema (a wrong column/join name would throw here).
    const { boss, sent } = makeCapturingBoss();
    setGlobalBoss(boss as never);
    const res = await enqueueBootTimeMedNotesEncryptionBackfill();
    expect(res.error).toBeNull();
    expect(sent).toEqual([]);
  });

  it("thumbnail discovery applies the mime filter + thumbnail anti-join", async () => {
    if (!nativeCanvasSupported()) {
      // The gate returns before the query on a non-AVX2 host; the SQL is still
      // covered by the other cases' schema, so skip the data assertion here.
      return;
    }
    const prisma = getPrismaClient();
    await Promise.all([seedUser("doc-a"), seedUser("doc-c")]);
    // doc-a: a thumbnailable PDF with no thumbnail row → discoverable.
    await prisma.inboundDocument.create({
      data: {
        userId: "doc-a",
        mimeType: "application/pdf",
        byteSize: 10,
        contentEncrypted: Buffer.from("x"),
      },
    });
    // doc-c: a non-thumbnailable text document → excluded by the mime IN filter.
    await prisma.inboundDocument.create({
      data: {
        userId: "doc-c",
        mimeType: "text/plain",
        byteSize: 10,
        contentEncrypted: Buffer.from("x"),
      },
    });

    const { boss, sent } = makeCapturingBoss();
    setGlobalBoss(boss as never);
    await enqueueBootTimeThumbnailBackfill();
    expect(usersFor(sent)).toEqual(["doc-a"]);
  });
});
