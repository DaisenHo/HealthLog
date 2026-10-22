/**
 * Who may call `POST /api/workouts/batch`, and what a narrow
 * `workouts:write` credential writes, against the real database and
 * through the real API kit (#1054).
 *
 * Pinned here, read back from the stored rows:
 *   - the route admits a cookie session, a wildcard token and a narrow token
 *     carrying exactly `workouts:write`; every other narrow token, however
 *     adjacent its scope looks, is 403 and writes nothing;
 *   - a `workouts:write` token counts in a rate-limit bucket of its own, apart
 *     from the phone's, while a session and a wildcard token share one;
 *   - a scoped caller's rows are `EXTERNAL`, resolved from the credential,
 *     and live in their own `(source, externalId)` namespace, so a bridge id
 *     equal to one the phone stored is a new row and its resend a duplicate;
 *   - a scoped body naming any source is 422
 *     `workout.batch.source_not_permitted` and writes nothing, while a session
 *     and a wildcard token keep the source they send.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "@/generated/prisma/client";
import { POST } from "@/app/api/workouts/batch/route";
import { MEASUREMENTS_WRITE_SCOPE } from "@/lib/measurements/scopes";
import { DOCUMENTS_WRITE_SCOPE } from "@/lib/documents/scopes";
import { WORKOUTS_WRITE_SCOPE } from "@/lib/workouts/scopes";

import { callRoute, type RouteAuth } from "../../kit/call-route";
import {
  makeSession,
  makeToken,
  makeUser,
  makeWorkout,
} from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/workouts/batch";

interface BatchResult {
  processed: number;
  inserted: number;
  duplicates: number;
  entries: Array<{ index: number; status: string }>;
}

beforeEach(() => truncateAllTables(prisma));

function workout(
  externalId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sportType: "running",
    startedAt: "2026-09-20T06:30:00.000Z",
    endedAt: "2026-09-20T07:15:00.000Z",
    externalId,
    ...overrides,
  };
}

/** A second session the same day, so the cross-source picker keeps both. */
const EVENING = {
  startedAt: "2026-09-20T18:00:00.000Z",
  endedAt: "2026-09-20T18:45:00.000Z",
};

function post(workouts: Array<Record<string, unknown>>, auth: RouteAuth) {
  return callRoute<BatchResult>(POST, {
    method: "POST",
    route: ROUTE,
    body: { workouts },
    auth,
  });
}

async function storedSources(user: Pick<User, "id">): Promise<string[]> {
  const rows = await prisma.workout.findMany({
    where: { userId: user.id },
    orderBy: { startedAt: "asc" },
    select: { source: true },
  });
  return rows.map((r) => r.source);
}

/** The rate-limit buckets this account's calls have opened, and their counts. */
async function buckets(user: Pick<User, "id">) {
  const rows = await prisma.rateLimit.findMany({
    where: { key: { contains: user.id } },
    orderBy: { key: "asc" },
    select: { key: true, count: true },
  });
  return rows;
}

describe("POST /api/workouts/batch: which credentials it admits", () => {
  it("admits a narrow workouts:write token", async () => {
    const user = await makeUser();

    const res = await post(
      [workout("s-1")],
      await makeToken(user, { permissions: [WORKOUTS_WRITE_SCOPE] }),
    );

    expect(res.status).toBe(200);
    expect(res.data.inserted).toBe(1);
    expect(await prisma.workout.count({ where: { userId: user.id } })).toBe(1);
  });

  it("admits a cookie session", async () => {
    const user = await makeUser();

    const res = await post(
      [workout("s-1", { source: "APPLE_HEALTH" })],
      await makeSession(user),
    );

    expect(res.status).toBe(200);
    expect(res.data.inserted).toBe(1);
  });

  it("admits a wildcard token", async () => {
    const user = await makeUser();

    const res = await post(
      [workout("s-1", { source: "APPLE_HEALTH" })],
      await makeToken(user),
    );

    expect(res.status).toBe(200);
    expect(res.data.inserted).toBe(1);
  });

  it.each([
    ["measurements:write", [MEASUREMENTS_WRITE_SCOPE]],
    ["documents:write", [DOCUMENTS_WRITE_SCOPE]],
    ["medication:ingest", ["medication:ingest", "medication:m-1:ingest"]],
    ["health:read", ["health:read"]],
  ])("refuses a %s token with 403 and writes nothing", async (_, perms) => {
    const user = await makeUser();

    const res = await post(
      [workout("s-1")],
      await makeToken(user, { permissions: perms }),
    );

    expect(res.status).toBe(403);
    expect(res.meta?.errorCode).toBe("auth.scope.insufficient");
    expect(await prisma.workout.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("POST /api/workouts/batch: rate-limit buckets", () => {
  it("counts a workouts:write token apart from the phone", async () => {
    const user = await makeUser();
    const bridge = await makeToken(user, {
      permissions: [WORKOUTS_WRITE_SCOPE],
    });
    const phone = await makeToken(user);

    expect((await post([workout("s-1")], bridge)).status).toBe(200);
    expect(
      (await post([workout("s-2", { source: "APPLE_HEALTH" })], phone)).status,
    ).toBe(200);

    const opened = await buckets(user);
    expect(opened).toHaveLength(2);
    expect(opened.map((b) => b.count)).toEqual([1, 1]);
  });

  it("keeps a session and a wildcard token in the same bucket", async () => {
    const user = await makeUser();

    await post(
      [workout("s-1", { source: "APPLE_HEALTH" })],
      await makeSession(user),
    );
    await post(
      [workout("s-2", { source: "APPLE_HEALTH", ...EVENING })],
      await makeToken(user),
    );

    const opened = await buckets(user);
    expect(opened).toHaveLength(1);
    expect(opened[0].count).toBe(2);
  });
});

describe("POST /api/workouts/batch: what a scoped caller writes", () => {
  it("attributes its rows to EXTERNAL", async () => {
    const user = await makeUser();

    const res = await post(
      [workout("s-1"), workout("s-2", EVENING)],
      await makeToken(user, { permissions: [WORKOUTS_WRITE_SCOPE] }),
    );

    expect(res.status).toBe(200);
    expect(res.data.inserted).toBe(2);
    expect(await storedSources(user)).toEqual(["EXTERNAL", "EXTERNAL"]);
  });

  it("dedups in the EXTERNAL namespace: the phone's id is no collision, its own resend is", async () => {
    const user = await makeUser();
    // The phone already stored a different session under the same id.
    await makeWorkout(user, {
      source: "APPLE_HEALTH",
      externalId: "s-1",
      startedAt: new Date("2026-09-18T06:30:00.000Z"),
      endedAt: new Date("2026-09-18T07:15:00.000Z"),
      durationSec: 2700,
    });
    const bridge = await makeToken(user, {
      permissions: [WORKOUTS_WRITE_SCOPE],
    });

    const first = await post([workout("s-1")], bridge);
    const resend = await post([workout("s-1")], bridge);

    expect(first.data.entries).toEqual([
      expect.objectContaining({ index: 0, status: "inserted" }),
    ]);
    expect(resend.data.entries).toEqual([
      expect.objectContaining({ index: 0, status: "duplicate" }),
    ]);
    expect(await storedSources(user)).toEqual(["APPLE_HEALTH", "EXTERNAL"]);
  });

  it.each(["APPLE_HEALTH", "MANUAL"])(
    "refuses a body naming %s with 422 and writes nothing",
    async (source) => {
      const user = await makeUser();

      const res = await post(
        [workout("s-1"), workout("s-2", { source, ...EVENING })],
        await makeToken(user, { permissions: [WORKOUTS_WRITE_SCOPE] }),
      );

      expect(res.status).toBe(422);
      expect(res.meta?.errorCode).toBe("workout.batch.source_not_permitted");
      expect(await prisma.workout.count({ where: { userId: user.id } })).toBe(
        0,
      );
    },
  );

  it("keeps the source a wildcard caller sends", async () => {
    const user = await makeUser();

    await post(
      [workout("s-1", { source: "APPLE_HEALTH" })],
      await makeToken(user),
    );

    expect(await storedSources(user)).toEqual(["APPLE_HEALTH"]);
  });

  it("keeps the source a session sends", async () => {
    const user = await makeUser();

    await post([workout("s-1", { source: "MANUAL" })], await makeSession(user));

    expect(await storedSources(user)).toEqual(["MANUAL"]);
  });
});
