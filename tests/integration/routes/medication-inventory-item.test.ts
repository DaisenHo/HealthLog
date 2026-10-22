/**
 * `/api/medications/{id}/inventory/{itemId}` — correct and remove one supply
 * container, against the real database and through the real API kit.
 *
 * Pinned here:
 *   - an opening date flips an unopened pen to IN_USE and starts its 30-day
 *     clock; one back-dated past that window lands at EXPIRED; the same
 *     back-dated date on a blister stays IN_USE with no deadline, because a
 *     blister carries no post-opening clock; a null opening date returns the
 *     container to ACTIVE and drops its deadline;
 *   - `markAsUsedUp` zeros the count and is terminal; a stock correction
 *     sets the count absolutely, clamps to the capacity, derives USED_UP at
 *     zero, and a negative count is refused;
 *   - carton labelling is written when sent, untouched when absent, cleared
 *     on an explicit null;
 *   - the correction and the delete wait for the per-medication inventory
 *     lock the intake consumption holds, and the correction reads the row
 *     only once it holds the lock, so a concurrent decrement is not undone;
 *   - the delete is a hard delete whose audit row keeps what the container
 *     was; each write shows on the medications list's very next read;
 *   - another account's container, or one filed under another medication,
 *     is 404 and stays as it was; malformed bodies answer the multi-issue
 *     422 and change nothing; anonymous is 401.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { GET as LIST_MEDICATIONS } from "@/app/api/medications/route";
import {
  DELETE,
  PATCH,
} from "@/app/api/medications/[id]/inventory/[itemId]/route";
import { lockMedicationInventory } from "@/lib/medications/inventory/consumption";

import { anonymous, callRoute, type RouteAuth } from "../../kit/call-route";
import { makeMedication, makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/medications/{id}/inventory/{itemId}";
const DAY_MS = 24 * 60 * 60 * 1000;

interface InventoryItem {
  id: string;
  state: string;
  unitsTotal: number;
  unitsRemaining: number;
  firstUseAt: string | null;
  expiresAt: string | null;
  manufacturer: string | null;
  doseStrength: string | null;
}

interface ValidationBody {
  details: { issues: Array<Record<string, unknown>> };
}

beforeEach(async () => {
  await truncateAllTables(prisma);
});

async function addContainer(
  userId: string,
  medicationId: string,
  overrides: Partial<
    Omit<
      Prisma.MedicationInventoryItemUncheckedCreateInput,
      "userId" | "medicationId"
    >
  > = {},
) {
  return prisma.medicationInventoryItem.create({
    data: {
      userId,
      medicationId,
      containerType: "PEN",
      unitsTotal: 4,
      unitsRemaining: 4,
      ...overrides,
    },
  });
}

async function stored(itemId: string) {
  const row = await prisma.medicationInventoryItem.findUnique({
    where: { id: itemId },
  });
  return row
    ? {
        state: row.state,
        unitsRemaining: Number(row.unitsRemaining),
        firstUseAt: row.firstUseAt,
        expiresAt: row.expiresAt,
        manufacturer: row.manufacturer,
        doseStrength: row.doseStrength,
      }
    : null;
}

/** A whole-second instant `days` from now, so it round-trips the wire. */
function daysFromNow(days: number): Date {
  const at = new Date(Date.now() + days * DAY_MS);
  at.setUTCMilliseconds(0);
  return at;
}

async function listedStock(
  auth: RouteAuth,
  medicationId: string,
): Promise<number | null | undefined> {
  const res = await callRoute<
    Array<{ id: string; stockUnitsRemaining: number | null }>
  >(LIST_MEDICATIONS, { method: "GET", route: "/api/medications", auth });
  expect(res.status).toBe(200);
  return res.data.find((m) => m.id === medicationId)?.stockUnitsRemaining;
}

async function owned() {
  const owner = await makeUser();
  const med = await makeMedication(owner);
  return { owner, med, session: await makeSession(owner) };
}

function patch(
  auth: RouteAuth,
  medicationId: string,
  itemId: string,
  body: unknown,
) {
  return callRoute<InventoryItem>(PATCH, {
    method: "PATCH",
    route: ROUTE,
    params: { id: medicationId, itemId },
    body,
    auth,
  });
}

describe("PATCH — the opening date", () => {
  it("flips an unopened pen to IN_USE and starts its 30-day clock", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id);
    const openedAt = daysFromNow(-1);

    const res = await patch(session, med.id, item.id, {
      markAsFirstUseAt: openedAt.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(res.data.state).toBe("IN_USE");
    expect(await stored(item.id)).toMatchObject({
      state: "IN_USE",
      firstUseAt: openedAt,
      expiresAt: new Date(openedAt.getTime() + 30 * DAY_MS),
      unitsRemaining: 4,
    });

    const audit = await prisma.auditLog.findMany({
      where: { userId: owner.id, action: "medication.inventory.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "{}")).toMatchObject({
      medicationId: med.id,
      itemId: item.id,
      prevState: "ACTIVE",
      nextState: "IN_USE",
    });
  });

  it("lands a pen opened more than 30 days ago at EXPIRED", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id);
    const openedAt = daysFromNow(-45);

    const res = await patch(session, med.id, item.id, {
      markAsFirstUseAt: openedAt.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      state: "EXPIRED",
      firstUseAt: openedAt,
    });
  });

  it("keeps a blister opened 45 days ago IN_USE with no deadline", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id, {
      containerType: "BLISTER",
      unitsTotal: 60,
      unitsRemaining: 54,
    });
    const openedAt = daysFromNow(-45);

    const res = await patch(session, med.id, item.id, {
      markAsFirstUseAt: openedAt.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      state: "IN_USE",
      firstUseAt: openedAt,
      expiresAt: null,
      unitsRemaining: 54,
    });
  });

  it("clears the opening date on null, back to ACTIVE with no deadline", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id, {
      state: "IN_USE",
      firstUseAt: daysFromNow(-5),
      expiresAt: daysFromNow(25),
    });

    const res = await patch(session, med.id, item.id, {
      markAsFirstUseAt: null,
    });

    expect(res.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      state: "ACTIVE",
      firstUseAt: null,
      expiresAt: null,
    });
  });
});

describe("PATCH — used up and stock corrections", () => {
  it("zeros the count and marks the container USED_UP, and the list shows it next read", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id, {
      state: "IN_USE",
      firstUseAt: daysFromNow(-2),
      unitsRemaining: 2,
    });
    expect(await listedStock(session, med.id)).toBe(2);

    const res = await patch(session, med.id, item.id, { markAsUsedUp: true });

    expect(res.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      state: "USED_UP",
      unitsRemaining: 0,
    });
    expect(await listedStock(session, med.id)).toBe(0);
  });

  it.each([
    [1, 1, "IN_USE"],
    [0, 0, "USED_UP"],
    [99, 4, "IN_USE"],
  ])(
    "sets unitsRemaining %s as %s units, state %s",
    async (sent, expected, state) => {
      const { owner, med, session } = await owned();
      const item = await addContainer(owner.id, med.id, {
        state: "IN_USE",
        firstUseAt: daysFromNow(-1),
        unitsRemaining: 3,
      });

      const res = await patch(session, med.id, item.id, {
        unitsRemaining: sent,
      });

      expect(res.status).toBe(200);
      expect(res.data.unitsRemaining).toBe(expected);
      expect(await stored(item.id)).toMatchObject({
        unitsRemaining: expected,
        state,
      });
    },
  );

  it("refuses a negative correction with 422 and leaves the count", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id, { unitsRemaining: 3 });

    const res = await patch(session, med.id, item.id, { unitsRemaining: -1 });

    expect(res.status).toBe(422);
    expect((await stored(item.id))?.unitsRemaining).toBe(3);
  });

  it.each([
    [
      "two",
      { markAsFirstUseAt: "not-iso", markAsUsedUp: "string" },
      ["markAsFirstUseAt", "markAsUsedUp"],
    ],
    [
      "three",
      {
        markAsFirstUseAt: "not-iso",
        markAsUsedUp: "string",
        printedExpiry: "also-bad",
        notes: 123,
      },
      ["markAsFirstUseAt", "markAsUsedUp", "notes", "printedExpiry"],
    ],
  ])(
    "answers %s or more simultaneous body errors at once and changes nothing",
    async (_n, body, paths) => {
      const { owner, med, session } = await owned();
      const item = await addContainer(owner.id, med.id);
      const before = await stored(item.id);

      const res = await patch(session, med.id, item.id, body);

      expect(res.status).toBe(422);
      expect(res.error).toBe("Validation failed");
      const issues = (res.body as ValidationBody).details.issues;
      expect(issues.map((i) => i.path).sort()).toEqual(paths);
      for (const issue of issues) {
        expect(Object.keys(issue).sort()).toEqual(["code", "message", "path"]);
      }
      expect(await stored(item.id)).toEqual(before);
    },
  );
});

describe("PATCH — carton labelling", () => {
  it("writes manufacturer and strength when sent", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id);

    const res = await patch(session, med.id, item.id, {
      manufacturer: "Example Pharma",
      doseStrength: "5 mg/0.5 ml",
    });

    expect(res.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      manufacturer: "Example Pharma",
      doseStrength: "5 mg/0.5 ml",
    });
  });

  it("leaves both untouched when the request omits them, and clears only the one sent as null", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id, {
      manufacturer: "Example Pharma",
      doseStrength: "5 mg/0.5 ml",
    });

    const untouched = await patch(session, med.id, item.id, {
      unitsRemaining: 2,
    });
    expect(untouched.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      unitsRemaining: 2,
      manufacturer: "Example Pharma",
      doseStrength: "5 mg/0.5 ml",
    });

    const cleared = await patch(session, med.id, item.id, {
      manufacturer: null,
    });
    expect(cleared.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      manufacturer: null,
      doseStrength: "5 mg/0.5 ml",
    });
  });
});

describe("PATCH / DELETE — the inventory lock", () => {
  /**
   * Hold the per-medication inventory lock the intake consumption takes,
   * optionally doing work inside it, until `release` is called.
   */
  async function holdLock(
    medicationId: string,
    inside: (tx: Prisma.TransactionClient) => Promise<void> = async () => {},
  ) {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalHeld = () => {};
    const held = new Promise<void>((resolve) => {
      signalHeld = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await lockMedicationInventory(tx, medicationId);
        await inside(tx);
        signalHeld();
        await released;
      },
      { timeout: 15_000 },
    );
    await held;
    return { release, holder };
  }

  async function stillPending(promise: Promise<unknown>): Promise<boolean> {
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    return !settled;
  }

  it("waits for a concurrent decrement and does not write the count back over it", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id, {
      state: "IN_USE",
      firstUseAt: daysFromNow(-1),
      unitsRemaining: 3,
    });
    // A dose being consumed: the decrement is made under the lock and is
    // not committed yet when the correction arrives.
    const { release, holder } = await holdLock(med.id, async (tx) => {
      await tx.medicationInventoryItem.update({
        where: { id: item.id },
        data: { unitsRemaining: 2 },
      });
    });

    const correction = patch(session, med.id, item.id, {
      manufacturer: "Example Pharma",
    });
    expect(await stillPending(correction)).toBe(true);

    release();
    await holder;
    const res = await correction;

    expect(res.status).toBe(200);
    expect(await stored(item.id)).toMatchObject({
      unitsRemaining: 2,
      manufacturer: "Example Pharma",
    });
  });

  it("makes a delete wait for the lock before removing the container", async () => {
    const { owner, med, session } = await owned();
    const item = await addContainer(owner.id, med.id);
    const { release, holder } = await holdLock(med.id);

    const removal = callRoute(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id, itemId: item.id },
      auth: session,
    });
    expect(await stillPending(removal)).toBe(true);
    expect(await stored(item.id)).not.toBeNull();

    release();
    await holder;
    expect((await removal).status).toBe(200);
    expect(await stored(item.id)).toBeNull();
  });
});

describe("DELETE /api/medications/{id}/inventory/{itemId}", () => {
  it("removes the row, audits what the container was, and the list drops its stock next read", async () => {
    const { owner, med, session } = await owned();
    const expiry = daysFromNow(10);
    const item = await addContainer(owner.id, med.id, {
      state: "IN_USE",
      firstUseAt: daysFromNow(-1),
      unitsRemaining: 2,
      doseStrength: "5 mg/0.5 ml",
      printedExpiry: expiry,
      expiresAt: expiry,
    });
    expect(await listedStock(session, med.id)).toBe(2);

    const res = await callRoute<{ id: string; deleted: boolean }>(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id, itemId: item.id },
      auth: session,
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: item.id, deleted: true });
    expect(await stored(item.id)).toBeNull();

    const audit = await prisma.auditLog.findMany({
      where: { userId: owner.id, action: "medication.inventory.delete" },
    });
    expect(audit).toHaveLength(1);
    const details = JSON.parse(audit[0]?.details ?? "{}");
    expect(details).toMatchObject({
      medicationId: med.id,
      itemId: item.id,
      finalState: "IN_USE",
      unitsRemaining: 2,
    });
    expect(JSON.stringify(details)).toContain("5 mg/0.5 ml");

    // The medication has no container left, so it tracks no stock at all.
    expect(await listedStock(session, med.id)).toBeNull();
  });
});

describe("ownership", () => {
  it("answers 404 for another account's container and for one under another medication, and both stay", async () => {
    const { owner, med, session } = await owned();
    const sibling = await makeMedication(owner);
    const other = await makeUser();
    const theirMed = await makeMedication(other);
    const theirs = await addContainer(other.id, theirMed.id, {
      unitsRemaining: 3,
    });
    const siblings = await addContainer(owner.id, sibling.id, {
      unitsRemaining: 3,
    });

    const results = [
      await patch(session, theirMed.id, theirs.id, { markAsUsedUp: true }),
      await patch(session, med.id, siblings.id, { markAsUsedUp: true }),
      await callRoute(DELETE, {
        method: "DELETE",
        route: ROUTE,
        params: { id: theirMed.id, itemId: theirs.id },
        auth: session,
      }),
      await callRoute(DELETE, {
        method: "DELETE",
        route: ROUTE,
        params: { id: med.id, itemId: siblings.id },
        auth: session,
      }),
    ];

    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(await stored(theirs.id)).toMatchObject({
      state: "ACTIVE",
      unitsRemaining: 3,
    });
    expect(await stored(siblings.id)).toMatchObject({
      state: "ACTIVE",
      unitsRemaining: 3,
    });
  });

  it("answers 401 to an anonymous caller and changes nothing", async () => {
    const { owner, med } = await owned();
    const item = await addContainer(owner.id, med.id);

    const res = await patch(anonymous, med.id, item.id, {
      markAsUsedUp: true,
    });
    const removal = await callRoute(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: med.id, itemId: item.id },
      auth: anonymous,
    });

    expect(res.status).toBe(401);
    expect(removal.status).toBe(401);
    expect(await stored(item.id)).toMatchObject({
      state: "ACTIVE",
      unitsRemaining: 4,
    });
  });
});
