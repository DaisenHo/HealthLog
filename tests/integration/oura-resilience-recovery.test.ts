/**
 * Oura's resilience level from the API to what the recovery page reads,
 * against the real schema, with the Oura API mocked at the network edge.
 *
 * The recovery page charts device-native recovery signals; for an Oura ring
 * the only one is `daily_resilience`. Two paths decide whether that page can
 * fill: a grant that covers the collection imports the level and the
 * summaries the page gates on carry it; a grant that leaves the collection
 * out is recorded, and the integrations read names resilience as withheld by
 * permission, which is the fact the page's empty note is chosen from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { encrypt } from "@/lib/crypto";

import { getPrismaClient, truncateAllTables } from "./setup";

const USER = "user-oura-resilience";

function today(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

beforeEach(async () => {
  const prisma = getPrismaClient();
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: {
      id: USER,
      username: "oura-resilience",
      email: "oura-resilience@example.test",
      timezone: "UTC",
      ouraAccessTokenEncrypted: encrypt("acc"),
      ouraRefreshTokenEncrypted: encrypt("ref"),
      ouraClientIdEncrypted: encrypt("client"),
      ouraClientSecretEncrypted: encrypt("secret"),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stub Oura: every collection answers an empty page except readiness (one
 * day) and resilience, which either answers two days or refuses the grant.
 */
function stubOura(resilience: "granted" | "refused") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes("oauth")) {
        return json(200, {
          access_token: "acc2",
          refresh_token: "ref2",
          token_type: "bearer",
          expires_in: 86_400,
        });
      }
      if (url.pathname.endsWith("/daily_resilience")) {
        if (resilience === "refused") return json(401, { detail: "scope" });
        return json(200, {
          data: [
            {
              id: "r1",
              day: today(-2),
              level: "solid",
              contributors: {
                sleep_recovery: 70,
                daytime_recovery: 60,
                stress: 50,
              },
            },
            {
              id: "r2",
              day: today(-1),
              level: "strong",
              contributors: {
                sleep_recovery: 80,
                daytime_recovery: 65,
                stress: 55,
              },
            },
          ],
          next_token: null,
        });
      }
      if (url.pathname.endsWith("/daily_readiness")) {
        return json(200, {
          data: [{ id: "d1", day: today(-1), score: 81 }],
          next_token: null,
        });
      }
      return json(200, { data: [], next_token: null });
    }),
  );
}

describe("Oura resilience reaches the recovery page", () => {
  it("imports the level and the page's summaries carry it", async () => {
    stubOura("granted");
    const { syncUserOura } = await import("@/lib/oura/sync");
    const result = await syncUserOura(USER, { lookbackDays: 7 });
    expect(result.failed).toBe(false);

    const prisma = getPrismaClient();
    const rows = await prisma.measurement.findMany({
      where: { userId: USER, type: "RESILIENCE", deletedAt: null },
      orderBy: { measuredAt: "asc" },
      select: { value: true, source: true },
    });
    expect(rows).toEqual([
      { value: 3, source: "OURA" },
      { value: 4, source: "OURA" },
    ]);

    const { computeSummariesSlice } =
      await import("@/lib/analytics/summaries-slice");
    const slice = await computeSummariesSlice(USER);
    expect(slice.summaries.RESILIENCE?.count).toBe(2);
    expect(slice.summaries.RESILIENCE?.latest).toBe(4);
  });

  it("names resilience as withheld by permission when the grant leaves it out", async () => {
    stubOura("refused");
    const { syncUserOura } = await import("@/lib/oura/sync");
    const result = await syncUserOura(USER, { lookbackDays: 7 });
    // A scope gap is not a sync failure.
    expect(result.failed).toBe(false);

    const prisma = getPrismaClient();
    expect(
      await prisma.measurement.count({
        where: { userId: USER, type: "RESILIENCE" },
      }),
    ).toBe(0);
    // Readiness still lands: the ring's recovery score, linked from the page.
    expect(
      await prisma.measurement.count({
        where: { userId: USER, type: "RECOVERY_SCORE" },
      }),
    ).toBe(1);

    const { loadConnectionHealth } =
      await import("@/lib/integrations/connection-health-load");
    const health = await loadConnectionHealth(USER, ["oura"]);
    expect(health.oura?.unavailable).toContainEqual({
      item: "resilience",
      cause: "permission",
    });
  });
});
