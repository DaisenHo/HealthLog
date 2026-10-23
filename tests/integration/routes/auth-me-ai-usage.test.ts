/**
 * `PUT /api/auth/me/ai-usage` — the account's own AI usage level, within the
 * operator's ceiling, against the real database and through the real API kit.
 *
 * Pinned here:
 *   - a level within the ceiling is stored, audited, and answered as the
 *     resolved state, with the per-option estimates scaled from the measured
 *     daily tokens of the last week;
 *   - a level above the ceiling is refused with 422 `ai.usage.aboveCeiling`
 *     and the ceiling named, never capped silently, and accepted once the
 *     operator raises the ceiling;
 *   - `null` returns to the instance default; fewer than three measured days
 *     give no estimate;
 *   - a malformed body is 422 `ai.usage.invalid`; the 31st change in an hour
 *     is 429 `ai.usage.rateLimited`; an anonymous caller is 401.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { PUT } from "@/app/api/auth/me/ai-usage/route";
import { shiftDateKey, userDayKey } from "@/lib/tz/format";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/ai-usage";

type UsageOption = {
  level: string;
  allowed: boolean;
  estimatedTokensPerDay: number | null;
};
type AiUsageState = {
  level: string;
  preference: string | null;
  defaultLevel: string;
  maxLevel: string;
  source: string;
  measuredTokensPerDay: number | null;
  measuredDays: number;
  options: UsageOption[];
};

beforeEach(() => truncateAllTables(prisma));

async function storedLevel(userId: string) {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { aiUsageLevel: true },
  });
  return row.aiUsageLevel;
}

/** One `coach_usage` row per past day, yesterday first, in UTC. */
async function seedDailyTokens(userId: string, perDay: number[]) {
  const today = userDayKey(new Date(), "UTC");
  await prisma.coachUsage.createMany({
    data: perDay.map((totalTokens, i) => ({
      userId,
      dateKey: shiftDateKey(today, -(i + 1)),
      totalTokens,
    })),
  });
}

describe("PUT /api/auth/me/ai-usage", () => {
  it("stores a level within the ceiling and answers the resolved state", async () => {
    const user = await makeUser({ timezone: "UTC" });
    await seedDailyTokens(user.id, [90_000, 110_000, 100_000]);

    const res = await callRoute<AiUsageState>(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { level: "frugal" },
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(await storedLevel(user.id)).toBe("FRUGAL");
    expect(res.data).toMatchObject({
      level: "frugal",
      preference: "frugal",
      defaultLevel: "standard",
      maxLevel: "standard",
      source: "user",
      measuredTokensPerDay: 100_000,
      measuredDays: 3,
    });
    expect(res.data.options).toEqual([
      { level: "frugal", allowed: true, estimatedTokensPerDay: 100_000 },
      { level: "standard", allowed: true, estimatedTokensPerDay: 200_000 },
      { level: "full", allowed: false, estimatedTokensPerDay: 666_667 },
    ]);

    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "user.aiUsage.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "null")).toEqual({
      previous: null,
      next: "frugal",
    });
  });

  it("refuses a level above the ceiling with the ceiling named", async () => {
    const user = await makeUser();
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { level: "full" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(res.meta).toMatchObject({
      errorCode: "ai.usage.aboveCeiling",
      maxLevel: "standard",
    });
    expect(await storedLevel(user.id)).toBeNull();
  });

  it("accepts full once the operator allows it", async () => {
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", aiUsageMaxLevel: "FULL" },
      update: { aiUsageMaxLevel: "FULL" },
    });
    const user = await makeUser();
    const res = await callRoute<AiUsageState>(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { level: "full" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data.level).toBe("full");
    expect(await storedLevel(user.id)).toBe("FULL");
  });

  it("returns to the instance default on null", async () => {
    const user = await makeUser({ timezone: "UTC", aiUsageLevel: "FRUGAL" });
    // Two measured days: fewer than the three an estimate needs.
    await seedDailyTokens(user.id, [100_000, 100_000]);

    const res = await callRoute<AiUsageState>(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { level: null },
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(await storedLevel(user.id)).toBeNull();
    expect(res.data).toMatchObject({
      level: "standard",
      preference: null,
      source: "default",
    });
    expect(res.data.options.map((o) => o.estimatedTokensPerDay)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it.each([
    [{ level: "lavish" }],
    [{}],
    [{ level: "frugal", extra: true }],
    [{ level: 1 }],
  ])("refuses %j as invalid and stores nothing", async (body) => {
    const user = await makeUser({ aiUsageLevel: "STANDARD" });
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(res.meta?.errorCode).toBe("ai.usage.invalid");
    expect(await storedLevel(user.id)).toBe("STANDARD");
  });

  it("allows 30 changes an hour and refuses the 31st", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const session = await makeSession(user);
    for (let i = 0; i < 30; i++) {
      const ok = await callRoute(PUT, {
        method: "PUT",
        route: ROUTE,
        body: { level: i % 2 === 0 ? "frugal" : "standard" },
        auth: session,
      });
      expect(ok.status).toBe(200);
    }
    const refused = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { level: "frugal" },
      auth: session,
    });
    expect(refused.status).toBe(429);
    expect(refused.meta?.errorCode).toBe("ai.usage.rateLimited");
    // The 30th change set standard; the refused one did not land.
    expect(await storedLevel(user.id)).toBe("STANDARD");

    // The window is an hour: the account's bucket in Postgres resets about
    // sixty minutes after the first change, not after one.
    const [bucket] = await prisma.$queryRaw<Array<{ secondsLeft: number }>>`
      SELECT EXTRACT(EPOCH FROM reset_at - (NOW() AT TIME ZONE 'UTC'))::float8
        AS "secondsLeft"
      FROM rate_limits WHERE key = ${`ai-usage:${user.id}`}
    `;
    expect(bucket?.secondsLeft).toBeGreaterThan(55 * 60);
    expect(bucket?.secondsLeft).toBeLessThanOrEqual(60 * 60);

    const neighbour = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { level: "frugal" },
      auth: await makeSession(other),
    });
    expect(neighbour.status).toBe(200);
  });

  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { level: "frugal" },
      auth: anonymous,
    });
    expect(res.status).toBe(401);
  });
});
