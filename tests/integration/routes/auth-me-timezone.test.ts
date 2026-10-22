/**
 * `PUT /api/auth/me/timezone` — the account timezone, against the real
 * database and through the real API kit.
 *
 * Pinned here:
 *   - any zone the engine's `Intl` knows is stored, trimmed, and audited with
 *     the previous and next zone; an unknown, empty or missing zone is 422 and
 *     leaves the column alone;
 *   - the resolver's per-user cache follows the write;
 *   - a change re-buckets the supplement nutrient days through a recompute
 *     job on the real queue, and saving the same zone again queues none.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgBoss } from "pg-boss";

import { PUT } from "@/app/api/auth/me/timezone/route";
import { setGlobalBoss } from "@/lib/jobs/boss-instance";
import { SUPPLEMENT_NUTRIENT_RECOMPUTE_QUEUE } from "@/lib/medications/ingredients/recompute-job";
import { resolveUserTimezone } from "@/lib/tz/resolver";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/timezone";

let boss: PgBoss;

beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  await boss.start();
  await boss.createQueue(SUPPLEMENT_NUTRIENT_RECOMPUTE_QUEUE);
  setGlobalBoss(boss);
}, 120_000);

afterAll(async () => {
  setGlobalBoss(null);
  await boss?.stop({ graceful: false });
});

beforeEach(() => truncateAllTables(prisma));

async function storedTimezone(userId: string): Promise<string> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
  return row.timezone;
}

/** The recompute is awaited by the route, so its job is on the queue on return. */
async function recomputeJobs(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pgboss.job
    WHERE name = ${SUPPLEMENT_NUTRIENT_RECOMPUTE_QUEUE}
      AND singleton_key = ${`supplement-nutrient-recompute|${userId}`}
  `;
  return rows[0]?.n ?? 0;
}

describe("PUT /api/auth/me/timezone", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { timezone: "Europe/Berlin" },
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("stores a valid IANA zone, answers it and audits previous and next", async () => {
    const user = await makeUser({ timezone: "Europe/Berlin" });
    const res = await callRoute<{ timezone: string }>(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { timezone: "Pacific/Auckland" },
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ timezone: "Pacific/Auckland" });
    expect(await storedTimezone(user.id)).toBe("Pacific/Auckland");

    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "user.timezone.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "null")).toEqual({
      previous: "Europe/Berlin",
      next: "Pacific/Auckland",
    });
  });

  it.each([
    ["an unknown zone", { timezone: "Mars/Olympus" }],
    ["an empty zone", { timezone: "" }],
    ["a missing field", {}],
  ])("refuses %s with 422 and leaves the column alone", async (_, body) => {
    const user = await makeUser({ timezone: "Europe/Berlin" });
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(await storedTimezone(user.id)).toBe("Europe/Berlin");
  });

  it("trims whitespace before validating and stores the trimmed zone", async () => {
    const user = await makeUser({ timezone: "Europe/Berlin" });
    const res = await callRoute<{ timezone: string }>(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { timezone: "  Asia/Tokyo  " },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ timezone: "Asia/Tokyo" });
    expect(await storedTimezone(user.id)).toBe("Asia/Tokyo");
  });

  it("drops the resolver's cached zone, so the next resolution reads the new one", async () => {
    const user = await makeUser({ timezone: "Europe/Berlin" });
    expect(await resolveUserTimezone(user.id)).toBe("Europe/Berlin");

    await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { timezone: "America/New_York" },
      auth: await makeSession(user),
    });

    expect(await resolveUserTimezone(user.id)).toBe("America/New_York");
  });

  // The supplement nutrient rows' day keys were minted under the old zone;
  // without the recompute nothing re-buckets them.
  it("queues the nutrient recompute when the zone actually changes", async () => {
    const user = await makeUser({ timezone: "Europe/Berlin" });
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { timezone: "America/New_York" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(await recomputeJobs(user.id)).toBe(1);
  });

  it("queues no recompute when the zone is unchanged", async () => {
    const user = await makeUser({ timezone: "Europe/Berlin" });
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { timezone: "Europe/Berlin" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(await recomputeJobs(user.id)).toBe(0);
  });
});
