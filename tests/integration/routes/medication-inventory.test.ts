/**
 * `/api/medications/{id}/inventory` — list and register supply containers,
 * against the real database and through the real API kit.
 *
 * Pinned here:
 *   - the list carries this medication's containers of this record only,
 *     with a server-computed supply summary: ACTIVE and IN_USE units pool
 *     into the available stock, divided by the medication's units per dose;
 *     an EXPIRED container is reported apart and never counts as available;
 *   - a registration stores an ACTIVE container holding its full capacity,
 *     unopened, with the printed expiry as its deadline, the carton
 *     labelling when sent and null when not, and an audit row;
 *   - the medications list shows the new stock on the very next read rather
 *     than serving the cached pre-write figure;
 *   - 30 registrations a minute per account, the 31st refused with 429 and
 *     nothing stored;
 *   - malformed bodies answer the multi-issue 422 and store nothing; another
 *     account's medication is 404 and gains nothing; anonymous is 401.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { GET as LIST_MEDICATIONS } from "@/app/api/medications/route";
import { GET, POST } from "@/app/api/medications/[id]/inventory/route";

import { anonymous, callRoute, type RouteAuth } from "../../kit/call-route";
import { makeMedication, makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/medications/{id}/inventory";
const DAY_MS = 24 * 60 * 60 * 1000;

interface InventoryItem {
  id: string;
  state: string;
  containerType: string;
  unitsTotal: number;
  unitsRemaining: number;
  firstUseAt: string | null;
  expiresAt: string | null;
  printedExpiry: string | null;
  manufacturer: string | null;
  doseStrength: string | null;
  notes: string | null;
}

interface ListBody {
  items: InventoryItem[];
  summary: {
    unitsRemaining: number;
    unitsTotal: number;
    dosesRemaining: number;
    dosesTotal: number;
    expiredUnits: number;
  };
  meta: { total: number };
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
      unitsTotal: 4,
      unitsRemaining: 4,
      ...overrides,
    },
  });
}

/** The stock the medications list reports for one medication. */
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

describe("GET /api/medications/{id}/inventory", () => {
  it("lists this medication's containers with the dose-derived supply summary", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const med = await makeMedication(owner, { unitsPerDose: 2 });
    const sibling = await makeMedication(owner);
    const theirMed = await makeMedication(other);
    await addContainer(owner.id, med.id, {
      state: "IN_USE",
      unitsRemaining: 3,
      firstUseAt: new Date(Date.now() - DAY_MS),
    });
    await addContainer(owner.id, med.id, { state: "ACTIVE" });
    await addContainer(owner.id, med.id, { state: "EXPIRED" });
    await addContainer(owner.id, med.id, {
      state: "USED_UP",
      unitsRemaining: 0,
    });
    await addContainer(owner.id, sibling.id);
    await addContainer(other.id, theirMed.id);

    const res = await callRoute<ListBody>(GET, {
      method: "GET",
      route: ROUTE,
      params: { id: med.id },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data.items.map((i) => i.state).sort()).toEqual([
      "ACTIVE",
      "EXPIRED",
      "IN_USE",
      "USED_UP",
    ]);
    expect(res.data.meta.total).toBe(4);
    // 7 available units at 2 per dose is 3 whole doses; the 8-unit capacity
    // is 4; the expired container's 4 units are visible and never available.
    expect(res.data.summary).toEqual({
      unitsRemaining: 7,
      unitsTotal: 8,
      dosesRemaining: 3,
      dosesTotal: 4,
      expiredUnits: 4,
    });
  });

  it("answers 404 for another account's medication and 401 to an anonymous caller", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeMedication(other);
    await addContainer(other.id, theirs.id);

    const foreign = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      params: { id: theirs.id },
      auth: await makeSession(owner),
    });
    const anon = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      params: { id: theirs.id },
      auth: anonymous,
    });

    expect(foreign.status).toBe(404);
    expect(anon.status).toBe(401);
  });
});

describe("POST /api/medications/{id}/inventory", () => {
  it("registers an unopened ACTIVE container whose deadline is the printed expiry", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const printed = new Date(Date.now() + 300 * DAY_MS);
    printed.setUTCMilliseconds(0);

    const res = await callRoute<InventoryItem>(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: med.id },
      body: { unitsTotal: 4, printedExpiry: printed.toISOString() },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      state: "ACTIVE",
      containerType: "OTHER",
      unitsTotal: 4,
      unitsRemaining: 4,
      firstUseAt: null,
      expiresAt: printed.toISOString(),
    });
    const row = await prisma.medicationInventoryItem.findUniqueOrThrow({
      where: { id: res.data.id },
    });
    expect(row).toMatchObject({
      userId: owner.id,
      medicationId: med.id,
      state: "ACTIVE",
      containerType: "OTHER",
      firstUseAt: null,
      printedExpiry: printed,
      expiresAt: printed,
      manufacturer: null,
      doseStrength: null,
    });
    expect(Number(row.unitsTotal)).toBe(4);
    expect(Number(row.unitsRemaining)).toBe(4);

    const audit = await prisma.auditLog.findMany({
      where: { userId: owner.id, action: "medication.inventory.create" },
    });
    expect(audit.map((a) => JSON.parse(a.details ?? "{}"))).toEqual([
      {
        medicationId: med.id,
        itemId: row.id,
        unitsTotal: 4,
        containerType: "OTHER",
      },
    ]);
  });

  it("stores the carton labelling when sent, and null for both when not", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const session = await makeSession(owner);

    const pen = await callRoute<InventoryItem>(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: med.id },
      body: {
        unitsTotal: 4,
        containerType: "PEN",
        manufacturer: "Example Pharma",
        doseStrength: "5 mg/0.5 ml",
      },
      auth: session,
    });
    const blister = await callRoute<InventoryItem>(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: med.id },
      body: { unitsTotal: 30, containerType: "BLISTER" },
      auth: session,
    });

    expect(pen.status).toBe(201);
    expect(blister.status).toBe(201);
    const rows = await prisma.medicationInventoryItem.findMany({
      where: { id: { in: [pen.data.id, blister.data.id] } },
      select: {
        id: true,
        containerType: true,
        manufacturer: true,
        doseStrength: true,
      },
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          id: pen.data.id,
          containerType: "PEN",
          manufacturer: "Example Pharma",
          doseStrength: "5 mg/0.5 ml",
        },
        {
          id: blister.data.id,
          containerType: "BLISTER",
          manufacturer: null,
          doseStrength: null,
        },
      ]),
    );
  });

  it("shows the new stock on the medications list's very next read", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const session = await makeSession(owner);
    // Warm the cached list: no container yet, so no stock is tracked.
    expect(await listedStock(session, med.id)).toBeNull();
    // The control: a container written behind the route's back is not seen,
    // because the list is served from its cache.
    await addContainer(owner.id, med.id, { unitsTotal: 2, unitsRemaining: 2 });
    expect(await listedStock(session, med.id)).toBeNull();

    const res = await callRoute(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: med.id },
      body: { unitsTotal: 4 },
      auth: session,
    });
    expect(res.status).toBe(201);

    expect(await listedStock(session, med.id)).toBe(6);
  });

  it("refuses unitsTotal 0 with 422 and stores nothing", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);

    const res = await callRoute(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: med.id },
      body: { unitsTotal: 0 },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(422);
    expect(await prisma.medicationInventoryItem.count()).toBe(0);
  });

  it.each([
    [
      "two",
      { unitsTotal: "string", printedExpiry: "not-iso" },
      ["printedExpiry", "unitsTotal"],
    ],
    [
      "three",
      {
        unitsTotal: "string",
        printedExpiry: "not-iso",
        purchasedAt: "also-not-iso",
        notes: 123,
      },
      ["notes", "printedExpiry", "purchasedAt", "unitsTotal"],
    ],
  ])(
    "answers %s or more simultaneous body errors at once",
    async (_n, body, paths) => {
      const owner = await makeUser();
      const med = await makeMedication(owner);

      const res = await callRoute(POST, {
        method: "POST",
        route: ROUTE,
        params: { id: med.id },
        body,
        auth: await makeSession(owner),
      });

      expect(res.status).toBe(422);
      expect(res.error).toBe("Validation failed");
      const issues = (res.body as ValidationBody).details.issues;
      expect(issues.map((i) => i.path).sort()).toEqual(paths);
      for (const issue of issues) {
        expect(Object.keys(issue).sort()).toEqual(["code", "message", "path"]);
      }
      expect(await prisma.medicationInventoryItem.count()).toBe(0);
    },
  );

  it("allows 30 registrations a minute per account and refuses the 31st with 429", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const session = await makeSession(owner);
    for (let i = 0; i < 30; i++) {
      const ok = await callRoute(POST, {
        method: "POST",
        route: ROUTE,
        params: { id: med.id },
        body: { unitsTotal: 1 },
        auth: session,
      });
      expect(ok.status).toBe(201);
    }

    const refused = await callRoute(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: med.id },
      body: { unitsTotal: 1 },
      auth: session,
    });

    expect(refused.status).toBe(429);
    expect(
      await prisma.medicationInventoryItem.count({
        where: { medicationId: med.id },
      }),
    ).toBe(30);
  });

  it("answers 404 for another account's medication and registers nothing", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeMedication(other);

    const res = await callRoute(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: theirs.id },
      body: { unitsTotal: 4 },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(404);
    expect(await prisma.medicationInventoryItem.count()).toBe(0);
  });

  it("answers 401 to an anonymous caller", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);

    const res = await callRoute(POST, {
      method: "POST",
      route: ROUTE,
      params: { id: med.id },
      body: { unitsTotal: 4 },
      auth: anonymous,
    });

    expect(res.status).toBe(401);
    expect(await prisma.medicationInventoryItem.count()).toBe(0);
  });
});
