/**
 * `/api/auth/me/glucose-unit` — the blood-glucose display unit, against the
 * real database and through the real API kit.
 *
 * `User.glucoseUnit` is read by about thirty surfaces; this route is its one
 * writer. Pinned here:
 *   - the read resolves an account that never chose to mg/dL and reads back
 *     a chosen mmol/L;
 *   - the write stores the unit, answers it and audits previous and next;
 *     a unit outside the two the app renders, or a missing field, is 422 and
 *     leaves the column alone, because a stray string there would resolve to
 *     mg/dL and quietly put an mmol/L reader back on the wrong number;
 *   - a write that changes the unit re-warms the stored texts that quote it
 *     (here: the cached daily briefing, a force-warm job on the real queue),
 *     and saving the same unit again does not;
 *   - the write bucket allows 60 a minute per account.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgBoss } from "pg-boss";

import { GET, PATCH } from "@/app/api/auth/me/glucose-unit/route";
import { setGlobalBoss } from "@/lib/jobs/boss-instance";
import { INSIGHT_PREGENERATE_QUEUE } from "@/lib/jobs/insight-pregenerate-shared";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/glucose-unit";

type GlucoseUnit = { glucoseUnit: "mg/dL" | "mmol/L" };

let boss: PgBoss;

beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  await boss.start();
  await boss.createQueue(INSIGHT_PREGENERATE_QUEUE);
  setGlobalBoss(boss);
}, 120_000);

afterAll(async () => {
  setGlobalBoss(null);
  await boss?.stop({ graceful: false });
});

beforeEach(() => truncateAllTables(prisma));

async function forceWarmJobs(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pgboss.job
    WHERE name = ${INSIGHT_PREGENERATE_QUEUE}
      AND singleton_key = ${`force:${userId}`}
  `;
  return rows[0]?.n ?? 0;
}

/** The re-warm is fire-and-forget; wait for its job to land on the queue. */
async function waitForForceWarm(userId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await forceWarmJobs(userId)) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no force-warm job for ${userId}`);
}

async function storedUnit(userId: string): Promise<string | null> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { glucoseUnit: true },
  });
  return row.glucoseUnit;
}

describe("GET /api/auth/me/glucose-unit", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("resolves an account that never chose to mg/dL", async () => {
    const user = await makeUser({ glucoseUnit: null });
    const res = await callRoute<GlucoseUnit>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ glucoseUnit: "mg/dL" });
  });

  it("reads back the unit the account chose", async () => {
    const user = await makeUser({ glucoseUnit: "mmol/L" });
    const res = await callRoute<GlucoseUnit>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.data).toEqual({ glucoseUnit: "mmol/L" });
  });
});

describe("PATCH /api/auth/me/glucose-unit", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mmol/L" },
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("moves an account to mmol/L, answers it and audits the transition", async () => {
    const user = await makeUser({ glucoseUnit: null });
    const session = await makeSession(user);
    const res = await callRoute<GlucoseUnit>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mmol/L" },
      auth: session,
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ glucoseUnit: "mmol/L" });
    expect(await storedUnit(user.id)).toBe("mmol/L");

    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "user.glucose-unit.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "null")).toEqual({
      previous: "mg/dL",
      next: "mmol/L",
    });

    const read = await callRoute<GlucoseUnit>(GET, {
      method: "GET",
      route: ROUTE,
      auth: session,
    });
    expect(read.data).toEqual({ glucoseUnit: "mmol/L" });
  });

  it("moves an account back to mg/dL", async () => {
    const user = await makeUser({ glucoseUnit: "mmol/L" });
    const res = await callRoute<GlucoseUnit>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mg/dL" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ glucoseUnit: "mg/dL" });
    expect(await storedUnit(user.id)).toBe("mg/dL");
  });

  it("refuses a unit outside the two the app renders and stores nothing", async () => {
    const user = await makeUser({ glucoseUnit: "mmol/L" });
    const session = await makeSession(user);
    for (const bad of ["mmol/l", "mgdl", "imperial", "", 1]) {
      const res = await callRoute(PATCH, {
        method: "PATCH",
        route: ROUTE,
        body: { glucoseUnit: bad },
        auth: session,
      });
      expect(res.status).toBe(422);
    }
    expect(await storedUnit(user.id)).toBe("mmol/L");
  });

  it("refuses a body without the glucoseUnit field with 422", async () => {
    const user = await makeUser({ glucoseUnit: null });
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { otherField: "mmol/L" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(await storedUnit(user.id)).toBeNull();
  });

  it("allows 60 writes a minute per account and refuses the 61st with 429", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const session = await makeSession(user);
    for (let i = 0; i < 60; i++) {
      const ok = await callRoute(PATCH, {
        method: "PATCH",
        route: ROUTE,
        body: { glucoseUnit: i % 2 === 0 ? "mmol/L" : "mg/dL" },
        auth: session,
      });
      expect(ok.status).toBe(200);
    }
    const refused = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mmol/L" },
      auth: session,
    });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    // The 60th write set mg/dL; the refused one did not land.
    expect(await storedUnit(user.id)).toBe("mg/dL");

    const neighbour = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mmol/L" },
      auth: await makeSession(other),
    });
    expect(neighbour.status).toBe(200);
  });
});

describe("PATCH re-warms the texts that quote the unit", () => {
  it("queues a briefing re-warm when the unit actually changes", async () => {
    const user = await makeUser({
      glucoseUnit: null,
      insightsCachedAt: new Date(),
    });
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mmol/L" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    await waitForForceWarm(user.id);
  });

  it("queues nothing when the same unit is saved again", async () => {
    const unchanged = await makeUser({
      glucoseUnit: "mmol/L",
      insightsCachedAt: new Date(),
    });
    const changed = await makeUser({
      glucoseUnit: "mg/dL",
      insightsCachedAt: new Date(),
    });

    const same = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mmol/L" },
      auth: await makeSession(unchanged),
    });
    expect(same.status).toBe(200);

    // A second account that does change its unit, sent after the first: once
    // its job is on the queue, a re-warm the first write had started would
    // have landed as well.
    await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { glucoseUnit: "mmol/L" },
      auth: await makeSession(changed),
    });
    await waitForForceWarm(changed.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await forceWarmJobs(unchanged.id)).toBe(0);
  });
});
