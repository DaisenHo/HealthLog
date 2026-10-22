/**
 * `/api/auth/me/unit-preference` — the metric/imperial display preference,
 * against the real database and through the real API kit.
 *
 * Pinned here:
 *   - the read resolves anything other than `imperial` (a null on an account
 *     that predates the column, or a stray value) to `metric`;
 *   - the write stores the value, audits previous and next, and refuses an
 *     unknown value, malformed JSON, an oversized body and a non-JSON content
 *     type without touching the row;
 *   - a write that changes the unit re-warms the stored texts that quote it
 *     (here: the cached daily briefing, a force-warm job on the real queue),
 *     and saving the same unit again does not;
 *   - the write bucket allows 60 a minute per account.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgBoss } from "pg-boss";

import { GET, PATCH } from "@/app/api/auth/me/unit-preference/route";
import { setGlobalBoss } from "@/lib/jobs/boss-instance";
import { INSIGHT_PREGENERATE_QUEUE } from "@/lib/jobs/insight-pregenerate-shared";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/unit-preference";

type UnitPreference = { unitPreference: "metric" | "imperial" };

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

async function storedPreference(userId: string): Promise<string | null> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { unitPreference: true },
  });
  return row.unitPreference;
}

describe("GET /api/auth/me/unit-preference", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("answers metric for an account whose column is null", async () => {
    const user = await makeUser({ unitPreference: null });
    const res = await callRoute<UnitPreference>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ unitPreference: "metric" });
  });

  it("answers metric for a stored value that is not imperial", async () => {
    const user = await makeUser({ unitPreference: "furlongs" });
    const res = await callRoute<UnitPreference>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ unitPreference: "metric" });
  });

  it("answers imperial when it is stored", async () => {
    const user = await makeUser({ unitPreference: "imperial" });
    const res = await callRoute<UnitPreference>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.data).toEqual({ unitPreference: "imperial" });
  });
});

describe("PATCH /api/auth/me/unit-preference", () => {
  it("stores imperial, answers the next state and audits previous and next", async () => {
    const user = await makeUser({ unitPreference: null });
    const res = await callRoute<UnitPreference>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "imperial" },
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ unitPreference: "imperial" });
    expect(await storedPreference(user.id)).toBe("imperial");

    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "user.unit-preference.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "null")).toEqual({
      previous: "metric",
      next: "imperial",
    });

    const read = await callRoute<UnitPreference>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(read.data).toEqual({ unitPreference: "imperial" });
  });

  it("refuses an unknown value with 422 and stores nothing", async () => {
    const user = await makeUser({ unitPreference: "metric" });
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "furlongs" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(await storedPreference(user.id)).toBe("metric");
  });

  // The three cases below pin the capped `safeJson` read: malformed JSON is
  // 400 like every sibling scalar, an oversized body is 413 even when its
  // value is valid, and a non-JSON content type is 415.
  it("refuses a body that is not JSON with 400 and stores nothing", async () => {
    const user = await makeUser({ unitPreference: "metric" });
    // The kit serialises every body as JSON, so the unparseable body here is
    // the empty one, sent with a JSON content type.
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      headers: { "content-type": "application/json" },
      auth: await makeSession(user),
      contract: {
        skip: "the registry declares no 400 for this PATCH although the description names it",
      },
    });
    expect(res.status).toBe(400);
    expect(await storedPreference(user.id)).toBe("metric");
  });

  it("refuses a body over the 1 KB cap with 413 even when the value is valid", async () => {
    const user = await makeUser({ unitPreference: "metric" });
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "imperial", padding: "x".repeat(2048) },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(413);
    expect(await storedPreference(user.id)).toBe("metric");
  });

  it("refuses a non-JSON content type with 415", async () => {
    const user = await makeUser({ unitPreference: "metric" });
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: "unitPreference=imperial",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      auth: await makeSession(user),
      contract: {
        skip: "the registry declares no 415 for this PATCH although the description names it",
      },
    });
    expect(res.status).toBe(415);
    expect(await storedPreference(user.id)).toBe("metric");
  });

  it("allows 60 writes a minute per account and refuses the 61st with 429", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const session = await makeSession(user);
    for (let i = 0; i < 60; i++) {
      const ok = await callRoute(PATCH, {
        method: "PATCH",
        route: ROUTE,
        body: { unitPreference: i % 2 === 0 ? "imperial" : "metric" },
        auth: session,
      });
      expect(ok.status).toBe(200);
    }
    const refused = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "imperial" },
      auth: session,
    });
    expect(refused.status).toBe(429);
    // The 60th write set metric; the refused one did not land.
    expect(await storedPreference(user.id)).toBe("metric");

    const neighbour = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "imperial" },
      auth: await makeSession(other),
    });
    expect(neighbour.status).toBe(200);
  });
});

describe("PATCH re-warms the texts that quote the unit", () => {
  it("queues a briefing re-warm when the unit actually changes", async () => {
    const user = await makeUser({
      unitPreference: null,
      insightsCachedAt: new Date(),
    });
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "imperial" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    await waitForForceWarm(user.id);
  });

  it("queues nothing when the same unit is saved again", async () => {
    const unchanged = await makeUser({
      unitPreference: "imperial",
      insightsCachedAt: new Date(),
    });
    const changed = await makeUser({
      unitPreference: "metric",
      insightsCachedAt: new Date(),
    });

    const same = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "imperial" },
      auth: await makeSession(unchanged),
    });
    expect(same.status).toBe(200);

    // A second account that does change its unit, sent after the first: once
    // its job is on the queue, a re-warm the first write had started would
    // have landed as well.
    await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { unitPreference: "imperial" },
      auth: await makeSession(changed),
    });
    await waitForForceWarm(changed.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await forceWarmJobs(unchanged.id)).toBe(0);
  });
});
