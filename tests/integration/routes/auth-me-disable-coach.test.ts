/**
 * `/api/auth/me/disable-coach` — the per-account Coach opt-out, against the
 * real database and through the real API kit.
 *
 * Pinned here:
 *   - the read answers the stored flag, false on a fresh account;
 *   - the write stores the flag, answers the next state, and audits it under
 *     an enable or disable action with previous and next, also when the value
 *     does not change (the audit row mirrors the call);
 *   - a missing or non-boolean field, an undeclared key beside a valid one,
 *     and a body that is not JSON are refused without touching the row; the
 *     422 names the undeclared key without reflecting a hostile one verbatim;
 *   - the write bucket allows 60 a minute per account.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET, PATCH } from "@/app/api/auth/me/disable-coach/route";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/auth/me/disable-coach";

type DisableCoach = { disableCoach: boolean };

beforeEach(() => truncateAllTables(prisma));

async function storedFlag(userId: string): Promise<boolean> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { disableCoach: true },
  });
  return row.disableCoach;
}

async function auditRows(userId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { userId, action: { startsWith: "user.disable-coach." } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    action: r.action,
    details: JSON.parse(r.details ?? "null"),
  }));
}

describe("GET /api/auth/me/disable-coach", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      auth: anonymous,
    });
    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("answers false for a fresh account", async () => {
    const user = await makeUser();
    const res = await callRoute<DisableCoach>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ disableCoach: false });
  });

  it("answers true for an account that opted out", async () => {
    const user = await makeUser({ disableCoach: true });
    const res = await callRoute<DisableCoach>(GET, {
      method: "GET",
      route: ROUTE,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ disableCoach: true });
  });
});

describe("PATCH /api/auth/me/disable-coach", () => {
  it("refuses an anonymous caller with 401", async () => {
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true },
      auth: anonymous,
    });
    expect(res.status).toBe(401);
  });

  it("turns the flag on and audits the enable", async () => {
    const user = await makeUser();
    const res = await callRoute<DisableCoach>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ disableCoach: true });
    expect(await storedFlag(user.id)).toBe(true);
    expect(await auditRows(user.id)).toEqual([
      {
        action: "user.disable-coach.enable",
        details: { previous: false, next: true },
      },
    ]);
  });

  it("turns the flag off and audits the disable", async () => {
    const user = await makeUser({ disableCoach: true });
    const res = await callRoute<DisableCoach>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: false },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ disableCoach: false });
    expect(await storedFlag(user.id)).toBe(false);
    expect(await auditRows(user.id)).toEqual([
      {
        action: "user.disable-coach.disable",
        details: { previous: true, next: false },
      },
    ]);
  });

  it("writes through and audits when the flag already holds the value", async () => {
    const user = await makeUser({ disableCoach: true });
    const res = await callRoute<DisableCoach>(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(200);
    expect(await storedFlag(user.id)).toBe(true);
    expect(await auditRows(user.id)).toEqual([
      {
        action: "user.disable-coach.enable",
        details: { previous: true, next: true },
      },
    ]);
  });

  it.each([
    ["a missing field", { otherField: "ignored" }],
    ["a non-boolean field", { disableCoach: "true" }],
  ])("refuses %s with 422 and stores nothing", async (_label, body) => {
    const user = await makeUser();
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body,
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(await storedFlag(user.id)).toBe(false);
    expect(await auditRows(user.id)).toEqual([]);
  });

  // 400 with a machine code in `meta.errorCode`, like every route that reads
  // through `safeJson`; this one used to answer 422.
  it("refuses a body that is not JSON with 400 and its error code", async () => {
    const user = await makeUser();
    // The kit serialises every body as JSON, so the unparseable body here is
    // the empty one, sent with a JSON content type.
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      headers: { "content-type": "application/json" },
      auth: await makeSession(user),
      contract: {
        skip: "the registry declares no 400 for this PATCH, which answers one for a body that is not JSON",
      },
    });
    expect(res.status).toBe(400);
    expect(res.error).toBe("Invalid JSON body");
    expect(res.meta?.errorCode).toBe("disable-coach.body.invalid_json");
    expect(await storedFlag(user.id)).toBe(false);
  });

  it("allows 60 writes a minute per account and refuses the 61st with 429", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const session = await makeSession(user);
    for (let i = 0; i < 60; i++) {
      const ok = await callRoute(PATCH, {
        method: "PATCH",
        route: ROUTE,
        body: { disableCoach: i % 2 === 0 },
        auth: session,
      });
      expect(ok.status).toBe(200);
    }
    const refused = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true },
      auth: session,
    });
    expect(refused.status).toBe(429);
    // The 60th write turned it off; the refused one did not land.
    expect(await storedFlag(user.id)).toBe(false);
    expect(await auditRows(user.id)).toHaveLength(60);

    const neighbour = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true },
      auth: await makeSession(other),
    });
    expect(neighbour.status).toBe(200);
  });
});

/**
 * The body schema is `.strict()`: a key the route does not declare is refused
 * rather than trimmed away. The body worth pinning is the one that used to
 * succeed while doing something other than what it said:
 * `{ disableCoach: true, disableCoachh: false }` wrote `true` and answered 200.
 */
describe("PATCH /api/auth/me/disable-coach — unknown keys", () => {
  it("refuses an undeclared key beside a valid one and writes nothing", async () => {
    const user = await makeUser();
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true, disableCoachh: false },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(await storedFlag(user.id)).toBe(false);
    expect(await auditRows(user.id)).toEqual([]);
  });

  it("names the offending key in the 422", async () => {
    const user = await makeUser();
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true, disableCoachh: false },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            keys: ["disableCoachh"],
            message: expect.stringContaining("disableCoachh"),
          }),
        ]),
      },
    });
  });

  it("does not reflect a hostile key name back verbatim", async () => {
    const user = await makeUser();
    const res = await callRoute(PATCH, {
      method: "PATCH",
      route: ROUTE,
      body: { disableCoach: true, "<script>alert(1)</script>": 1 },
      auth: await makeSession(user),
    });
    expect(res.status).toBe(422);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("<script>");
    expect(raw).toContain("script_alert_1");
  });
});
