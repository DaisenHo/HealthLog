/**
 * `/api/auth/me/workout-routes` — the opt-in for keeping workout GPS tracks,
 * against the real database and through the real API kit.
 *
 * Off by default; the PATCH is a hard-set that stores the flag, audits
 * previous and next, and refuses a malformed body or an anonymous caller
 * without touching the row.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET, PATCH } from "@/app/api/auth/me/workout-routes/route";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/workout-routes";

type WorkoutRoutes = { storeWorkoutRoutes: boolean };

beforeEach(() => truncateAllTables(prisma));

async function storedFlag(userId: string): Promise<boolean> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { storeWorkoutRoutes: true },
  });
  return row.storeWorkoutRoutes;
}

describe("/api/auth/me/workout-routes", () => {
  it("reads off for an account that never chose", async () => {
    const user = await makeUser();
    const res = await callRoute<WorkoutRoutes>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ storeWorkoutRoutes: false });
  });

  it("stores the flag, answers it, and audits the change", async () => {
    const user = await makeUser();
    const session = await makeSession(user);
    const res = await callRoute<WorkoutRoutes>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { storeWorkoutRoutes: true },
      auth: session,
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ storeWorkoutRoutes: true });
    expect(await storedFlag(user.id)).toBe(true);

    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "user.storeWorkoutRoutes.update" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.details ?? "null")).toEqual({
      previous: false,
      next: true,
    });

    const read = await callRoute<WorkoutRoutes>(GET, {
      method: "GET",
      route: ROUTE,
      auth: session,
    });
    expect(read.data).toEqual({ storeWorkoutRoutes: true });
  });

  it("refuses a malformed body with 422 and writes nothing", async () => {
    const user = await makeUser();
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { storeWorkoutRoutes: "yes" },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(await storedFlag(user.id)).toBe(false);
    expect(await prisma.auditLog.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { storeWorkoutRoutes: true },
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });
});
