/**
 * `GET /api/auth/me/security-activity`: the account's recent security events,
 * against the real database and through the real API kit.
 *
 * What a person relies on here: the feed shows their own sign-in, export and
 * erasure events and nothing else, newest first in a total order, with the
 * IP masked and no event detail body; the page is capped at the requested
 * limit and says when more rows exist; a limit outside 1-100 is a 422 that
 * names it rather than a silent clamp.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/auth/me/security-activity/route";
import type { User } from "@/generated/prisma/client";

import { anonymous, callRoute, type RouteAuth } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();

type SecurityEvent = {
  action: string;
  createdAt: string;
  location: string | null;
  ipMasked: string | null;
  carrier: string | null;
};

beforeEach(async () => {
  await truncateAllTables(prisma);
});

async function audit(
  user: Pick<User, "id">,
  action: string,
  createdAt: Date,
  extra: { ipAddress?: string; location?: string; carrier?: string } = {},
) {
  return prisma.auditLog.create({
    data: {
      userId: user.id,
      action,
      createdAt,
      details: JSON.stringify({ secretish: "detail body" }),
      ...extra,
    },
  });
}

async function feed(auth: RouteAuth, limit?: number | string) {
  return callRoute<{ events: SecurityEvent[] }>(GET, {
    method: "GET",
    route: "/api/auth/me/security-activity",
    query: { limit },
    auth,
  });
}

describe("GET /api/auth/me/security-activity", () => {
  it("answers 401 without a credential", async () => {
    expect((await feed(anonymous)).status).toBe(401);
  });

  it("shows the caller's security events newest first, masked, without detail bodies, and nothing else", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await audit(
      owner,
      "auth.login.password",
      new Date("2026-05-01T08:00:00Z"),
      {
        ipAddress: "203.0.113.7",
        location: "Berlin, DE",
        carrier: "Example Carrier",
      },
    );
    await audit(owner, "export.download", new Date("2026-05-02T08:00:00Z"));
    await audit(owner, "user.data.clear", new Date("2026-05-03T08:00:00Z"));
    await audit(owner, "measurement.create", new Date("2026-05-04T08:00:00Z"));
    await audit(other, "auth.login.password", new Date("2026-05-05T08:00:00Z"));

    const res = await feed(await makeSession(owner));

    expect(res.status).toBe(200);
    expect(res.meta).toEqual({ truncated: false, limit: 50 });
    expect(res.data.events).toEqual([
      {
        action: "user.data.clear",
        createdAt: "2026-05-03T08:00:00.000Z",
        location: null,
        ipMasked: null,
        carrier: null,
      },
      {
        action: "export.download",
        createdAt: "2026-05-02T08:00:00.000Z",
        location: null,
        ipMasked: null,
        carrier: null,
      },
      {
        action: "auth.login.password",
        createdAt: "2026-05-01T08:00:00.000Z",
        location: "Berlin, DE",
        ipMasked: "203.0.x.x",
        carrier: "Example Carrier",
      },
    ]);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain("203.0.113.7");
    expect(serialised).not.toContain("detail body");
  });

  it("caps the page at the limit, says more exist, and breaks a timestamp tie by id", async () => {
    const owner = await makeUser();
    const same = new Date("2026-05-01T08:00:00Z");
    const rows = [
      await audit(owner, "auth.login.password", same),
      await audit(owner, "auth.login.passkey", same),
      await audit(owner, "auth.logout", same),
    ];
    const byIdDesc = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1));
    const session = await makeSession(owner);

    const capped = await feed(session, 2);
    expect(capped.status).toBe(200);
    expect(capped.meta).toEqual({ truncated: true, limit: 2 });
    expect(capped.data.events.map((e) => e.action)).toEqual(
      byIdDesc.slice(0, 2).map((r) => r.action),
    );

    const exact = await feed(session, 3);
    expect(exact.meta).toEqual({ truncated: false, limit: 3 });
    expect(exact.data.events.map((e) => e.action)).toEqual(
      byIdDesc.map((r) => r.action),
    );
  });

  it("answers a limit past the published ceiling with a 422 naming it", async () => {
    const owner = await makeUser();

    const res = await feed(await makeSession(owner), 500);

    expect(res.status).toBe(422);
    expect(res.meta?.errorCode).toBe("security_activity.invalid");
    expect(res.body).toMatchObject({
      details: { issues: [expect.objectContaining({ path: "limit" })] },
    });
  });
});
