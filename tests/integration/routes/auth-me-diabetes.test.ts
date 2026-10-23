/**
 * `/api/auth/me/diabetes` — the declared diabetes flag, against the real
 * database and through the real API kit.
 *
 * The flag switches every glucose surface from the general normal bands to
 * the glycemic goal bands and reaches the Coach snapshot; the web toggle in
 * the thresholds section rides this route. Pinned here:
 *   - the read answers false for an account that never declared it and true
 *     once it is stored;
 *   - the write stores the flag both ways, answers it and audits previous and
 *     next; a missing, non-boolean or unknown field is 422 and leaves the
 *     column alone;
 *   - the write bucket allows 60 a minute per account.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET, PATCH } from "@/app/api/auth/me/diabetes/route";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/diabetes";

type Diabetes = { hasDiabetes: boolean };

beforeEach(() => truncateAllTables(prisma));

async function storedFlag(userId: string): Promise<boolean> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { hasDiabetes: true },
  });
  return row.hasDiabetes;
}

describe("GET /api/auth/me/diabetes", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("answers false for an account that never declared the flag", async () => {
    const user = await makeUser();
    const res = await callRoute<Diabetes>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ hasDiabetes: false });
  });

  it("answers true once the flag is stored", async () => {
    const user = await makeUser({ hasDiabetes: true });
    const res = await callRoute<Diabetes>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ hasDiabetes: true });
  });
});

describe("PATCH /api/auth/me/diabetes", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { hasDiabetes: true },
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("turns the flag on, answers it, audits the transition and reads back", async () => {
    const user = await makeUser();
    const session = await makeSession(user);
    const res = await callRoute<Diabetes>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { hasDiabetes: true },
      auth: session,
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ hasDiabetes: true });
    expect(await storedFlag(user.id)).toBe(true);

    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "user.diabetes.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "null")).toEqual({
      previous: false,
      next: true,
    });

    const read = await callRoute<Diabetes>(GET, {
      method: "GET",
      route: ROUTE,
      auth: session,
    });
    expect(read.data).toEqual({ hasDiabetes: true });
  });

  it("turns the flag off and answers the resolved state", async () => {
    const user = await makeUser({ hasDiabetes: true });
    const res = await callRoute<Diabetes>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { hasDiabetes: false },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ hasDiabetes: false });
    expect(await storedFlag(user.id)).toBe(false);
  });

  it.each([
    ["a missing hasDiabetes field", { otherField: true }],
    ["a non-boolean hasDiabetes", { hasDiabetes: "true" }],
    ["an undeclared key beside it", { hasDiabetes: true, extra: 1 }],
  ])("refuses %s with 422 and stores nothing", async (_, body) => {
    const user = await makeUser();
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(await storedFlag(user.id)).toBe(false);
  });

  it("allows 60 writes a minute per account and refuses the 61st with 429", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const session = await makeSession(user);
    for (let i = 0; i < 60; i++) {
      const ok = await callRoute(PATCH, {
        method: "PATCH",
        route: ROUTE,
        body: { hasDiabetes: i % 2 === 0 },
        auth: session,
      });
      expect(ok.status).toBe(200);
    }
    const refused = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { hasDiabetes: true },
      auth: session,
    });
    expect(refused.status).toBe(429);
    // The 60th write set false; the refused one did not land.
    expect(await storedFlag(user.id)).toBe(false);

    const neighbour = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { hasDiabetes: true },
      auth: await makeSession(other),
    });
    expect(neighbour.status).toBe(200);
  });
});
