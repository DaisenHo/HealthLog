/**
 * The Coach's history of one lab marker is read in full, whatever else the
 * account has measured since.
 *
 * The block used to read the newest 4,000 lab rows of every marker and match
 * the asked-for one in memory afterwards. An account with more than that many
 * newer readings of other markers (a home glucose or INR log is enough) lost
 * the asked-for marker's older readings, so its `count` and `firstTakenAt`
 * named a shorter history than the record holds, or the marker vanished. The
 * same history also left out a reading whose unit was written another way
 * ("MG/DL" beside "mg/dL").
 */
import { beforeEach, describe, expect, it } from "vitest";

import { buildLabsSnapshotBlock } from "@/lib/ai/coach/labs-snapshot";

import { makeUser } from "../kit/factories";
import { getPrismaClient, truncateAllTables } from "./setup";

const prisma = getPrismaClient();
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => truncateAllTables(prisma));

describe("buildLabsSnapshotBlock with an analyte", () => {
  it("reads the marker's whole history past thousands of newer readings of other markers", async () => {
    const user = await makeUser();
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

    // Three LDL readings, the oldest two years back; one of them stored with
    // the unit written in capitals.
    await prisma.labResult.createMany({
      data: [
        { takenAt: daysAgo(730), value: 151, unit: "MG/DL" },
        { takenAt: daysAgo(400), value: 142, unit: "mg/dL" },
        { takenAt: daysAgo(200), value: 128, unit: "mg/dL" },
      ].map((reading) => ({
        userId: user.id,
        analyte: "LDL",
        ...reading,
      })),
    });
    // 4,500 newer readings of another marker, all after the last LDL.
    await prisma.labResult.createMany({
      data: Array.from({ length: 4_500 }, (_, index) => ({
        userId: user.id,
        analyte: "Glucose",
        value: 90 + (index % 20),
        unit: "mg/dL",
        takenAt: new Date(daysAgo(199).getTime() + index * 60_000),
      })),
    });

    const block = await buildLabsSnapshotBlock(user.id, now, undefined, {
      analyte: "ldl",
    });

    expect(block?.recent).toHaveLength(1);
    const ldl = block!.recent[0]!;
    expect(ldl.analyte).toBe("LDL");
    expect(ldl.value).toBe(128);
    expect(ldl.history?.count).toBe(3);
    expect(ldl.history?.firstTakenAt).toBe(daysAgo(730).toISOString());
  });
});
