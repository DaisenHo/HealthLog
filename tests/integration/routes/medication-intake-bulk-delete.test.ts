/**
 * `POST /api/medications/{id}/intake/bulk-delete` — undo several doses in
 * one call, against the real database and through the real API kit.
 *
 * Pinned here:
 *   - the named doses of this medication and this record are tombstoned
 *     (`deletedAt` set, sync counter bumped), and `deleted` is the real
 *     count; ids of another medication or another account delete nothing
 *     and answer `deleted: 0`; re-posting tombstoned ids counts zero and
 *     bumps nothing;
 *   - a dose that consumed stock puts its units back, once; an unstamped
 *     dose touches no container;
 *   - every local day the deleted doses sat on is recomputed, so the
 *     supplement micronutrients of both days drop out;
 *   - the medications list reflects the deletion on its very next read;
 *   - an audit row carries the requested and the deleted count;
 *   - 30 calls a minute per account, the 31st refused with 429 before
 *     anything is deleted, another account's allowance untouched;
 *   - a malformed body is 422 and deletes nothing; another account's
 *     medication is 404; anonymous is 401.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { GET as LIST_MEDICATIONS } from "@/app/api/medications/route";
import { POST } from "@/app/api/medications/[id]/intake/bulk-delete/route";
import { recomputeSupplementNutrientsForUser } from "@/lib/medications/ingredients/recompute";

import { anonymous, callRoute, type RouteAuth } from "../../kit/call-route";
import { makeMedication, makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/medications/{id}/intake/bulk-delete";
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
    select: {
      id: true,
      deletedAt: true,
      syncVersion: true,
      inventoryConsumption: true,
    },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

function bulkDelete(auth: RouteAuth, medicationId: string, body: unknown) {
  return callRoute<{ deleted: number }>(POST, {
    method: "POST",
    route: ROUTE,
    params: { id: medicationId },
    body,
    auth,
  });
}

describe("POST /api/medications/{id}/intake/bulk-delete", () => {
  it("tombstones the named doses of this medication and reports the real count", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const a = await dose(owner.id, med.id, 1);
    const b = await dose(owner.id, med.id, 1, {
      scheduledFor: new Date(Date.now() - DAY_MS - 60_000),
    });
    const c = await dose(owner.id, med.id, 2);
    const kept = await dose(owner.id, med.id, 3);
    const session = await makeSession(owner);
    const before = Date.now();

    const res = await bulkDelete(session, med.id, {
      eventIds: [a.id, b.id, c.id, "not-a-real-id"],
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deleted: 3 });
    const state = await eventState([a.id, b.id, c.id, kept.id]);
    for (const event of [a, b, c]) {
      expect(state.get(event.id)?.deletedAt?.getTime()).toBeGreaterThanOrEqual(
        before,
      );
      expect(state.get(event.id)?.syncVersion).toBe(event.syncVersion + 1);
    }
    expect(state.get(kept.id)?.deletedAt).toBeNull();

    const audit = await prisma.auditLog.findMany({
      where: { userId: owner.id, action: "medication.intake.bulk_delete" },
    });
    expect(audit.map((r) => JSON.parse(r.details ?? "{}"))).toEqual([
      { medicationId: med.id, requestedCount: 4, deletedCount: 3 },
    ]);

    const again = await bulkDelete(session, med.id, { eventIds: [a.id] });
    expect(again.status).toBe(200);
    expect(again.data).toEqual({ deleted: 0 });
    expect((await eventState([a.id])).get(a.id)?.syncVersion).toBe(
      a.syncVersion + 1,
    );
  });

  it("deletes nothing for ids of another medication or another account", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const med = await makeMedication(owner);
    const sibling = await makeMedication(owner);
    const theirMed = await makeMedication(other);
    const siblings = await dose(owner.id, sibling.id, 1);
    const theirs = await dose(other.id, theirMed.id, 1);

    const res = await bulkDelete(await makeSession(owner), med.id, {
      eventIds: [siblings.id, theirs.id],
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deleted: 0 });
    const state = await eventState([siblings.id, theirs.id]);
    expect(state.get(siblings.id)?.deletedAt).toBeNull();
    expect(state.get(theirs.id)?.deletedAt).toBeNull();
  });

  it("puts a stamped dose's units back once and touches no container for an unstamped one", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const item = await prisma.medicationInventoryItem.create({
      data: {
        userId: owner.id,
        medicationId: med.id,
        state: "IN_USE",
        unitsTotal: 4,
        unitsRemaining: 2,
        firstUseAt: new Date(Date.now() - 3 * DAY_MS),
      },
    });
    const stamped = await dose(owner.id, med.id, 1, {
      inventoryConsumption: [{ itemId: item.id, units: 2 }],
    });
    const unstamped = await dose(owner.id, med.id, 2);
    const session = await makeSession(owner);

    const res = await bulkDelete(session, med.id, {
      eventIds: [stamped.id, unstamped.id],
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deleted: 2 });
    const container = await prisma.medicationInventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(Number(container.unitsRemaining)).toBe(4);
    const state = await eventState([stamped.id, unstamped.id]);
    expect(state.get(stamped.id)?.inventoryConsumption).toBeNull();
    expect(state.get(stamped.id)?.deletedAt).not.toBeNull();
    expect(state.get(unstamped.id)?.deletedAt).not.toBeNull();

    // A re-post finds the stamp already cleared and refunds nothing more.
    await bulkDelete(session, med.id, { eventIds: [stamped.id] });
    const after = await prisma.medicationInventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(Number(after.unitsRemaining)).toBe(4);
  });

  it("recomputes every day the deleted doses sat on", async () => {
    const owner = await makeUser({
      timezone: "UTC",
      modulePreferencesJson: { nutrients: true },
    });
    const med = await makeMedication(owner);
    await prisma.medicationIngredient.create({
      data: {
        userId: owner.id,
        medicationId: med.id,
        nutrient: "magnesium",
        amountPerUnit: 100,
        unit: "mg",
        source: "MANUAL",
      },
    });
    const first = await dose(owner.id, med.id, 1);
    const second = await dose(owner.id, med.id, 2);
    await recomputeSupplementNutrientsForUser(owner.id);
    const supplementDays = () =>
      prisma.nutrientIntakeDay.findMany({
        where: { userId: owner.id, source: "SUPPLEMENT" },
        select: { day: true },
        orderBy: { day: "asc" },
      });
    expect((await supplementDays()).map((r) => r.day)).toEqual([
      second.scheduledFor.toISOString().slice(0, 10),
      first.scheduledFor.toISOString().slice(0, 10),
    ]);

    const res = await bulkDelete(await makeSession(owner), med.id, {
      eventIds: [first.id, second.id],
    });

    expect(res.status).toBe(200);
    expect(await supplementDays()).toEqual([]);
  });

  it("shows the deletion on the medications list's very next read", async () => {
    const owner = await makeUser({ timezone: "UTC" });
    const med = await makeMedication(owner);
    const session = await makeSession(owner);
    const today = await dose(owner.id, med.id, 0);
    const listed = async () => {
      const res = await callRoute<
        Array<{ id: string; todayEventCount: number }>
      >(LIST_MEDICATIONS, {
        method: "GET",
        route: "/api/medications",
        auth: session,
      });
      expect(res.status).toBe(200);
      return res.data.find((m) => m.id === med.id)?.todayEventCount;
    };
    expect(await listed()).toBe(1);

    const res = await bulkDelete(session, med.id, { eventIds: [today.id] });
    expect(res.data).toEqual({ deleted: 1 });

    expect(await listed()).toBe(0);
  });

  it.each([
    ["a missing list", {}],
    ["an empty list", { eventIds: [] }],
    ["a non-string id", { eventIds: [42] }],
  ])("refuses %s with 422 and deletes nothing", async (_label, body) => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const event = await dose(owner.id, med.id, 1);

    const res = await bulkDelete(await makeSession(owner), med.id, body);

    expect(res.status).toBe(422);
    expect((await eventState([event.id])).get(event.id)?.deletedAt).toBeNull();
  });

  it("allows 30 calls a minute per account and refuses the 31st before deleting anything", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const med = await makeMedication(owner);
    const theirMed = await makeMedication(other);
    const target = await dose(owner.id, med.id, 1);
    const session = await makeSession(owner);
    for (let i = 0; i < 30; i++) {
      const ok = await bulkDelete(session, med.id, {
        eventIds: [`unknown-${i}`],
      });
      expect(ok.status).toBe(200);
    }

    const refused = await bulkDelete(session, med.id, {
      eventIds: [target.id],
    });

    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(
      (await eventState([target.id])).get(target.id)?.deletedAt,
    ).toBeNull();

    const neighbour = await bulkDelete(await makeSession(other), theirMed.id, {
      eventIds: ["unknown"],
    });
    expect(neighbour.status).toBe(200);
  });

  it("answers 404 for another account's medication and keeps its doses", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirMed = await makeMedication(other);
    const theirs = await dose(other.id, theirMed.id, 1);

    const res = await bulkDelete(await makeSession(owner), theirMed.id, {
      eventIds: [theirs.id],
    });

    expect(res.status).toBe(404);
    expect(
      (await eventState([theirs.id])).get(theirs.id)?.deletedAt,
    ).toBeNull();
  });

  it("answers 401 to an anonymous caller", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const event = await dose(owner.id, med.id, 1);

    const res = await bulkDelete(anonymous, med.id, { eventIds: [event.id] });

    expect(res.status).toBe(401);
    expect((await eventState([event.id])).get(event.id)?.deletedAt).toBeNull();
  });
});
