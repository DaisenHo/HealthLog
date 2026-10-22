/**
 * `GET /api/settings/reminder-thresholds`, against the real database and
 * through the real API kit.
 *
 * Pinned here:
 *   - an anonymous caller is refused;
 *   - the late and missed minutes are the operator's, read from the
 *     instance settings row, and fall back to 120 / 240 without one;
 *   - the low-stock runway and the reorder lead are the account's own: a
 *     fresh account reads the defaults (7 and 10), and the read reflects
 *     what `PATCH /api/auth/me/notification-prefs` stored, the OFF state
 *     (`null`) included. This is the read half of that settings round trip.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/settings/reminder-thresholds/route";
import { PATCH as patchPrefs } from "@/app/api/auth/me/notification-prefs/route";

import { anonymous, callRoute } from "../../kit/call-route";
import {
  makeSession,
  makeUser,
  type SessionFixture,
} from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/settings/reminder-thresholds";

interface Thresholds {
  lateMinutes: number;
  missedMinutes: number;
  lowStockRunwayDays: number | null;
  reorderLeadDays: number;
}

beforeEach(() => truncateAllTables(prisma));

function read(auth: SessionFixture) {
  return callRoute<Thresholds>(GET, { method: "GET", route: ROUTE, auth });
}

async function setRunway(auth: SessionFixture, days: number | null) {
  const res = await callRoute(patchPrefs, {
    method: "PATCH",
    route: "/api/auth/me/notification-prefs",
    body: { medication: { lowStockRunwayDays: days } },
    auth,
  });
  expect(res.status).toBe(200);
}

describe("GET /api/settings/reminder-thresholds", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      auth: anonymous,
    });

    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("answers the built-in defaults for a fresh account on an instance without a settings row", async () => {
    const res = await read(await makeSession(await makeUser()));

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      lateMinutes: 120,
      missedMinutes: 240,
      lowStockRunwayDays: 7,
      reorderLeadDays: 10,
    });
  });

  it("carries the operator's late and missed minutes beside the account's own defaults", async () => {
    await prisma.appSettings.create({
      data: {
        id: "singleton",
        reminderLateMinutes: 90,
        reminderMissedMinutes: 300,
      },
    });

    const res = await read(await makeSession(await makeUser()));

    expect(res.data).toEqual({
      lateMinutes: 90,
      missedMinutes: 300,
      lowStockRunwayDays: 7,
      reorderLeadDays: 10,
    });
  });

  it("reflects the runway the notification-prefs write stored, and only for that account", async () => {
    const session = await makeSession(await makeUser());
    const otherSession = await makeSession(await makeUser());
    await setRunway(session, 21);

    const own = await read(session);
    const other = await read(otherSession);

    expect(own.data.lowStockRunwayDays).toBe(21);
    expect(other.data.lowStockRunwayDays).toBe(7);
  });

  it("reflects the OFF state as null", async () => {
    const session = await makeSession(await makeUser());
    await setRunway(session, null);

    const res = await read(session);

    expect(res.status).toBe(200);
    expect(res.data.lowStockRunwayDays).toBeNull();
  });
});
