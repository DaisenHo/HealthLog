/**
 * `/api/auth/me/source-priority` — the per-metric source ladders, against the
 * real database and through the real API kit.
 *
 * Pinned here:
 *   - the read fills every key the analytics layer needs from the defaults
 *     when nothing is stored, and carries the sources the account holds data
 *     from beside the ladders;
 *   - the PUT stores the partial shape as sent (missing keys keep reading as
 *     defaults), audits previous and next, and refuses a malformed shape
 *     without touching the row.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET, PUT } from "@/app/api/auth/me/source-priority/route";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeMeasurement, makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/source-priority";

type SourcePriority = Record<string, unknown> & {
  weight: string[];
  inUse: string[];
};

beforeEach(() => truncateAllTables(prisma));

async function storedLadder(userId: string) {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sourcePriorityJson: true },
  });
  return row.sourcePriorityJson;
}

describe("GET /api/auth/me/source-priority", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      auth: anonymous,
    });
    expect(res.status).toBe(401);
  });

  it("answers the defaulted shape when nothing is stored", async () => {
    const user = await makeUser();
    const res = await callRoute<SourcePriority>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("weight");
    expect(res.data).toHaveProperty("metricPriority");
    expect(res.data).toHaveProperty("deviceTypePriority");
    expect(res.data.inUse).toEqual([]);
  });

  it("carries the sources the account holds data from beside the ladders", async () => {
    const user = await makeUser();
    const other = await makeUser();
    await makeMeasurement(user, { source: "WITHINGS" });
    await makeMeasurement(user, { source: "MANUAL" });
    await makeMeasurement(other, { source: "APPLE_HEALTH" });

    const res = await callRoute<SourcePriority>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect([...res.data.inUse].sort()).toEqual(["MANUAL", "WITHINGS"]);
  });
});

describe("PUT /api/auth/me/source-priority", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { weight: ["WITHINGS", "APPLE_HEALTH", "MANUAL"] },
      auth: anonymous,
    });
    expect(res.status).toBe(401);
  });

  it("stores the partial shape as sent and reads it back over the defaults", async () => {
    const user = await makeUser();
    const session = await makeSession(user);
    const body = { weight: ["MANUAL", "APPLE_HEALTH", "WITHINGS"] };

    const res = await callRoute<SourcePriority>(PUT, {
      method: "PUT",
      route: ROUTE,
      body,
      auth: session,
    });
    expect(res.status).toBe(200);
    // The resolved ladder leads with the chosen order; the resolver appends
    // the sources the body did not rank.
    expect(res.data.weight.slice(0, 3)).toEqual(body.weight);
    expect(await storedLadder(user.id)).toEqual(body);

    const read = await callRoute<SourcePriority>(GET, {
      method: "GET",
      route: ROUTE,
      auth: session,
    });
    expect(read.data.weight).toEqual(res.data.weight);
    expect(read.data).toHaveProperty("metricPriority");
  });

  it("refuses an invalid shape with 422 and stores nothing", async () => {
    const user = await makeUser();
    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body: { weight: "not-an-array" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(res.meta?.errorCode).toBe("source-priority.body.invalid_shape");
    expect(await storedLadder(user.id)).toBeNull();
  });

  it("audits the previous and the new shape", async () => {
    const previousShape = { weight: ["WITHINGS", "APPLE_HEALTH", "MANUAL"] };
    const user = await makeUser({ sourcePriorityJson: previousShape });
    const body = { weight: ["APPLE_HEALTH", "WITHINGS", "MANUAL"] };

    const res = await callRoute(PUT, {
      method: "PUT",
      route: ROUTE,
      body,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "user.source-priority.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "null")).toEqual({
      previous: previousShape,
      next: body,
    });
  });
});
