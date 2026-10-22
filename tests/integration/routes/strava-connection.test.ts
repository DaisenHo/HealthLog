/**
 * `POST /api/strava/disconnect` and `DELETE /api/strava/credentials`, against
 * the real database and through the real API kit.
 *
 * Both tear a connection down, and both must leave nothing of the connected
 * Strava account that a later connection would inherit: not the tokens, not
 * the athlete id, and not the backfill markers. A resume point left standing
 * made the next account's first history walk start below the old account's
 * oldest activity, so its newer history was never asked for. Both audit the
 * teardown and park the `strava` ledger at `disconnected`; only the
 * disconnect tells Strava. Strava's deauthorize endpoint is replaced at the
 * `safeFetch` seam.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/generated/prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { POST as disconnect } from "@/app/api/strava/disconnect/route";
import { DELETE as deleteCredentials } from "@/app/api/strava/credentials/route";

import { callRoute } from "../../kit/call-route";
import { makeSession, makeUser, makeWorkout } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const upstream = vi.hoisted(() => ({
  requests: [] as Array<{ url: string; authorization: string | null }>,
  deauthorizeStatus: 200,
}));

vi.mock("@/lib/safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/safe-fetch")>();
  return {
    ...actual,
    safeFetch: async (url: string | URL, init: RequestInit = {}) => {
      upstream.requests.push({
        url: String(url),
        authorization: new Headers(init.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ access_token: "access-1" }), {
        status: upstream.deauthorizeStatus,
        headers: { "content-type": "application/json" },
      });
    },
  };
});

const prisma = getPrismaClient();

const CONNECTED = {
  stravaClientIdEncrypted: encrypt("client-123"),
  stravaClientSecretEncrypted: encrypt("client-secret-xyz"),
  stravaAccessTokenEncrypted: encrypt("access-1"),
  stravaRefreshTokenEncrypted: encrypt("refresh-1"),
  stravaAthleteId: "9001",
  stravaLastActivityAt: new Date("2026-07-01T08:00:00Z"),
  stravaBackfillCompletedAt: null,
  stravaBackfillResumeBefore: new Date("2024-03-01T00:00:00Z"),
};

/** The columns a teardown must leave empty, as they read afterwards. */
const NOTHING_INHERITED = {
  stravaAccessTokenEncrypted: null,
  stravaRefreshTokenEncrypted: null,
  stravaAthleteId: null,
  stravaBackfillCompletedAt: null,
  stravaBackfillResumeBefore: null,
};

async function seedLedger(user: User): Promise<void> {
  await prisma.integrationStatus.create({
    data: {
      userId: user.id,
      integration: "strava",
      state: "error_transient",
      lastError: encrypt("Strava fetchActivities error: 503"),
      consecutiveFailuresByKind: {
        transient: 2,
        reauth_required: 0,
        persistent: 0,
      },
    },
  });
}

async function auditActions(userId: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId },
    select: { action: true },
  });
  return rows.map((r) => r.action);
}

function ledger(userId: string) {
  return prisma.integrationStatus.findUnique({
    where: { userId_integration: { userId, integration: "strava" } },
  });
}

beforeEach(async () => {
  await truncateAllTables(prisma);
  upstream.requests = [];
  upstream.deauthorizeStatus = 200;
});

describe("POST /api/strava/disconnect", () => {
  it("deauthorizes at Strava and clears the grant and the backfill markers, keeping the workouts", async () => {
    const user = await makeUser({
      ...CONNECTED,
      stravaBackfillCompletedAt: new Date("2026-06-01T00:00:00Z"),
    });
    await seedLedger(user);
    await makeWorkout(user, { source: "STRAVA", externalId: "1001" });

    const res = await callRoute(disconnect, {
      method: "POST",
      route: "/api/strava/disconnect",
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ disconnected: true });
    expect(upstream.requests).toEqual([
      {
        url: "https://www.strava.com/oauth/deauthorize",
        authorization: "Bearer access-1",
      },
    ]);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored).toMatchObject(NOTHING_INHERITED);
    // The account's own Strava app stays for the next connection.
    expect(decrypt(stored.stravaClientIdEncrypted ?? "")).toBe("client-123");
    expect(
      await prisma.workout.count({
        where: { userId: user.id, source: "STRAVA" },
      }),
    ).toBe(1);
    expect(await auditActions(user.id)).toContain("strava.disconnect");
    expect(await ledger(user.id)).toMatchObject({
      state: "disconnected",
      lastError: null,
    });
  });

  it("clears the connection even when Strava's deauthorize fails", async () => {
    const user = await makeUser(CONNECTED);
    upstream.deauthorizeStatus = 503;

    const res = await callRoute(disconnect, {
      method: "POST",
      route: "/api/strava/disconnect",
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject(NOTHING_INHERITED);
  });

  it("answers 404 to a second disconnect, which has no connection left to clear", async () => {
    const user = await makeUser(CONNECTED);
    const auth = await makeSession(user);

    const first = await callRoute(disconnect, {
      method: "POST",
      route: "/api/strava/disconnect",
      auth,
    });
    const second = await callRoute(disconnect, {
      method: "POST",
      route: "/api/strava/disconnect",
      auth,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(upstream.requests).toHaveLength(1);
  });

  it("leaves another account's connection alone", async () => {
    const user = await makeUser(CONNECTED);
    const other = await makeUser({
      ...CONNECTED,
      stravaAccessTokenEncrypted: encrypt("access-other"),
      stravaAthleteId: "9002",
    });

    await callRoute(disconnect, {
      method: "POST",
      route: "/api/strava/disconnect",
      auth: await makeSession(user),
    });

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(decrypt(untouched.stravaAccessTokenEncrypted ?? "")).toBe(
      "access-other",
    );
    expect(untouched.stravaBackfillResumeBefore).toEqual(
      CONNECTED.stravaBackfillResumeBefore,
    );
  });
});

describe("DELETE /api/strava/credentials", () => {
  it("removes the app, the grant and the backfill markers, audits it and parks the ledger, without telling Strava", async () => {
    const user = await makeUser(CONNECTED);
    await seedLedger(user);

    const res = await callRoute(deleteCredentials, {
      method: "DELETE",
      route: "/api/strava/credentials",
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deleted: true });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      ...NOTHING_INHERITED,
      stravaClientIdEncrypted: null,
      stravaClientSecretEncrypted: null,
    });
    expect(await auditActions(user.id)).toContain("strava.credentials.delete");
    expect(await ledger(user.id)).toMatchObject({
      state: "disconnected",
      lastError: null,
    });
    expect(upstream.requests).toEqual([]);
  });

  it("audits and parks the ledger even when nothing was ever connected", async () => {
    const user = await makeUser({
      stravaClientIdEncrypted: encrypt("client-123"),
      stravaClientSecretEncrypted: encrypt("client-secret-xyz"),
    });

    const res = await callRoute(deleteCredentials, {
      method: "DELETE",
      route: "/api/strava/credentials",
      auth: await makeSession(user),
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deleted: true });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      stravaClientIdEncrypted: null,
      stravaClientSecretEncrypted: null,
    });
    expect(await auditActions(user.id)).toContain("strava.credentials.delete");
    expect((await ledger(user.id))?.state).toBe("disconnected");
  });
});
