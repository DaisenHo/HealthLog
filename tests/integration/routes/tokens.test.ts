/**
 * `/api/tokens` and `/api/tokens/{id}` — list and revoke the caller's API
 * tokens, against the real database and through the real API kit.
 *
 * The decisions pinned here are the ones a person relies on when they go
 * looking for a credential to kill:
 *   - the list carries every token the account holds, revoked ones included,
 *     newest first, and never anyone else's;
 *   - the list is not gated on the operator's instance-wide API switch,
 *     because that switch does not stop a token authenticating, which the
 *     Bearer case below proves by authenticating with one while it is off;
 *   - the revoke is gated on the switch, reaches only the caller's own rows,
 *     and a revoked token stops authenticating on the very next request.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/tokens/route";
import { DELETE } from "@/app/api/tokens/[id]/route";

import { callRoute } from "../../kit/call-route";
import { makeSession, makeToken, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();

type TokenRow = {
  id: string;
  name: string;
  permissions: string[];
  revoked: boolean;
  createdAt: string;
};

beforeEach(async () => {
  await truncateAllTables(prisma);
});

async function switchApi(enabled: boolean): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", apiGlobal: enabled },
    update: { apiGlobal: enabled },
  });
}

describe("GET /api/tokens", () => {
  it("lists the caller's tokens newest first, revoked ones included, and nobody else's", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const older = await makeToken(owner, { name: "older" });
    const newer = await makeToken(owner, { name: "newer" });
    await prisma.apiToken.update({
      where: { id: older.tokenId },
      data: { revoked: true, createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await makeToken(other, { name: "not yours" });

    const res = await callRoute<TokenRow[]>(GET, {
      method: "GET",
      route: "/api/tokens",
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data.map((t) => [t.id, t.name, t.revoked])).toEqual([
      [newer.tokenId, "newer", false],
      [older.tokenId, "older", true],
    ]);
  });

  it("answers a Bearer caller while the operator has the API switched off", async () => {
    // The premise of the ungated list: the switch does not stop a token from
    // authenticating. Proven by authenticating with one while it is off.
    const owner = await makeUser();
    const phone = await makeToken(owner, { name: "phone" });
    await switchApi(false);

    const res = await callRoute<TokenRow[]>(GET, {
      method: "GET",
      route: "/api/tokens",
      auth: phone,
    });

    expect(res.status).toBe(200);
    expect(res.data.map((t) => t.id)).toEqual([phone.tokenId]);
  });

  it("refuses a narrow token that does not name this route's scope", async () => {
    const owner = await makeUser();
    const ingest = await makeToken(owner, {
      permissions: ["measurements:write"],
    });

    const res = await callRoute(GET, {
      method: "GET",
      route: "/api/tokens",
      auth: ingest,
    });

    expect(res.status).toBe(403);
    expect(res.meta?.errorCode).toBe("auth.scope.insufficient");
    expect(res.data).toBeNull();
  });
});

describe("DELETE /api/tokens/{id}", () => {
  it("revokes the caller's token, keeps the row listed, and the token stops authenticating", async () => {
    const owner = await makeUser();
    const session = await makeSession(owner);
    const phone = await makeToken(owner, { name: "phone" });

    const before = await callRoute(GET, {
      method: "GET",
      route: "/api/tokens",
      auth: phone,
    });
    expect(before.status).toBe(200);

    const res = await callRoute<{ revoked: boolean }>(DELETE, {
      method: "DELETE",
      route: "/api/tokens/{id}",
      params: { id: phone.tokenId },
      auth: session,
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ revoked: true });
    const row = await prisma.apiToken.findUniqueOrThrow({
      where: { id: phone.tokenId },
    });
    expect(row.revoked).toBe(true);

    const listed = await callRoute<TokenRow[]>(GET, {
      method: "GET",
      route: "/api/tokens",
      auth: session,
    });
    expect(listed.data).toEqual([
      expect.objectContaining({ id: phone.tokenId, revoked: true }),
    ]);

    const after = await callRoute(GET, {
      method: "GET",
      route: "/api/tokens",
      auth: phone,
    });
    expect(after.status).toBe(401);
  });

  it("answers 404 for another account's token and leaves it live", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeToken(other);

    const res = await callRoute(DELETE, {
      method: "DELETE",
      route: "/api/tokens/{id}",
      params: { id: theirs.tokenId },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(404);
    const row = await prisma.apiToken.findUniqueOrThrow({
      where: { id: theirs.tokenId },
    });
    expect(row.revoked).toBe(false);
  });

  it("refuses while the operator has the API switched off and revokes nothing", async () => {
    const owner = await makeUser();
    const phone = await makeToken(owner);
    await switchApi(false);

    const res = await callRoute(DELETE, {
      method: "DELETE",
      route: "/api/tokens/{id}",
      params: { id: phone.tokenId },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(403);
    const row = await prisma.apiToken.findUniqueOrThrow({
      where: { id: phone.tokenId },
    });
    expect(row.revoked).toBe(false);
  });
});
