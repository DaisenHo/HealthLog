/**
 * `DELETE /api/medications/{id}/intake/purge` — clear a medication's whole
 * intake history, against the real database and through the real API kit.
 *
 * Pinned here:
 *   - every live dose of this medication is tombstoned, not removed: the row
 *     stays with `deletedAt` set and its sync counter bumped, so the sync
 *     feed can carry the removal; the count in the answer is the number of
 *     rows tombstoned;
 *   - an already tombstoned dose, another medication's doses and another
 *     account's doses are untouched, and a second purge counts zero;
 *   - the purge refunds no inventory;
 *   - the medications list reflects the empty history on its very next read;
 *   - an audit row carries the count;
 *   - another account's medication is 404 and keeps its history; anonymous
 *     is 401.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { GET as LIST_MEDICATIONS } from "@/app/api/medications/route";
import { DELETE } from "@/app/api/medications/[id]/intake/purge/route";

import { anonymous, callRoute, type RouteAuth } from "../../kit/call-route";
import { makeMedication, makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/medications/{id}/intake/purge";
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await truncateAllTables(prisma);
});

async function dose(
  userId: string,
  medicationId: string,
  daysAgo: number,
  overrides: Partial<
    Omit<
      Prisma.MedicationIntakeEventUncheckedCreateInput,
      "userId" | "medicationId"
    >
  > = {},
) {
  const at = new Date(Date.now() - daysAgo * DAY_MS);
  return prisma.medicationIntakeEvent.create({
    data: {
      userId,
      medicationId,
      scheduledFor: at,
      takenAt: at,
      ...overrides,
    },
  });
}

async function eventState(ids: string[]) {
  const rows = await prisma.medicationIntakeEvent.findMany({
    where: { id: { in: ids } },
    select: { id: true, deletedAt: true, syncVersion: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

async function todayEventCount(
  auth: RouteAuth,
  medicationId: string,
): Promise<number | undefined> {
  const res = await callRoute<Array<{ id: string; todayEventCount: number }>>(
    LIST_MEDICATIONS,
    { method: "GET", route: "/api/medications", auth },
  );
  expect(res.status).toBe(200);
  return res.data.find((m) => m.id === medicationId)?.todayEventCount;
}

describe("DELETE /api/medications/{id}/intake/purge", () => {
  it("tombstones every live dose of this medication and leaves the rest alone", async () => {
    const owner = await makeUser({ timezone: "UTC" });
    const other = await makeUser();
    const med = await makeMedication(owner);
    const sibling = await makeMedication(owner);
    const theirMed = await makeMedication(other);
    const live = [
      await dose(owner.id, med.id, 0),
      await dose(owner.id, med.id, 1),
      await dose(owner.id, med.id, 2, { takenAt: null, skipped: true }),
    ];
    const gone = await dose(owner.id, med.id, 3, {
      deletedAt: new Date(Date.now() - DAY_MS),
      syncVersion: 4,
    });
    const siblings = await dose(owner.id, sibling.id, 0);
    const theirs = await dose(other.id, theirMed.id, 0);
    const session = await makeSession(owner);
    const before = Date.now();

    const res = await callRoute<{ purged: boolean; count: number }>(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id },
      auth: session,
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ purged: true, count: 3 });

    const state = await eventState([
      ...live.map((e) => e.id),
      gone.id,
      siblings.id,
      theirs.id,
    ]);
    // Tombstoned, not removed: every row is still there.
    expect(state.size).toBe(6);
    for (const event of live) {
      const row = state.get(event.id);
      expect(row?.deletedAt?.getTime()).toBeGreaterThanOrEqual(before);
      expect(row?.syncVersion).toBe(event.syncVersion + 1);
    }
    expect(state.get(gone.id)).toMatchObject({
      deletedAt: gone.deletedAt,
      syncVersion: 4,
    });
    expect(state.get(siblings.id)?.deletedAt).toBeNull();
    expect(state.get(theirs.id)?.deletedAt).toBeNull();

    const audit = await prisma.auditLog.findMany({
      where: { userId: owner.id, action: "medication.intake.purge" },
    });
    expect(audit.map((a) => JSON.parse(a.details ?? "{}"))).toEqual([
      { medicationId: med.id, name: med.name, deletedCount: 3 },
    ]);

    const again = await callRoute<{ purged: boolean; count: number }>(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id },
      auth: session,
    });
    expect(again.data).toEqual({ purged: true, count: 0 });
    const after = await eventState(live.map((e) => e.id));
    for (const event of live) {
      expect(after.get(event.id)?.syncVersion).toBe(event.syncVersion + 1);
    }
  });

  it("refunds no inventory for the purged doses", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const item = await prisma.medicationInventoryItem.create({
      data: {
        userId: owner.id,
        medicationId: med.id,
        state: "IN_USE",
        unitsTotal: 4,
        unitsRemaining: 2,
        firstUseAt: new Date(Date.now() - 2 * DAY_MS),
      },
    });
    const stamped = await dose(owner.id, med.id, 1, {
      inventoryConsumption: [{ itemId: item.id, units: 2 }],
    });

    const res = await callRoute(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    const row = await prisma.medicationInventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(Number(row.unitsRemaining)).toBe(2);
    expect(row.state).toBe("IN_USE");
    const event = await prisma.medicationIntakeEvent.findUniqueOrThrow({
      where: { id: stamped.id },
    });
    expect(event.deletedAt).not.toBeNull();
  });

  it("shows the cleared history on the medications list's very next read", async () => {
    const owner = await makeUser({ timezone: "UTC" });
    const med = await makeMedication(owner);
    const session = await makeSession(owner);
    await dose(owner.id, med.id, 0);
    expect(await todayEventCount(session, med.id)).toBe(1);

    const res = await callRoute(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id },
      auth: session,
    });
    expect(res.status).toBe(200);

    expect(await todayEventCount(session, med.id)).toBe(0);
  });

  it("answers 404 for another account's medication and keeps its history", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirMed = await makeMedication(other);
    const theirs = await dose(other.id, theirMed.id, 0);

    const res = await callRoute(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: theirMed.id },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(404);
    expect((await eventState([theirs.id])).get(theirs.id)).toMatchObject({
      deletedAt: null,
      syncVersion: theirs.syncVersion,
    });
  });

  it("answers 401 to an anonymous caller and keeps the history", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const event = await dose(owner.id, med.id, 0);

    const res = await callRoute(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id },
      auth: anonymous,
    });

    expect(res.status).toBe(401);
    expect((await eventState([event.id])).get(event.id)?.deletedAt).toBeNull();
  });
});
