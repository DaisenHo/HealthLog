/**
 * `/api/auth/me/sessions` and `/api/auth/me/sessions/{id}`: the active-session
 * list, "sign out everywhere else", and the single-session revoke, against the
 * real database and through the real API kit.
 *
 * What a person relies on here:
 *   - the list shows the account's own live sessions, most recently active
 *     first, with a coarse device label, a masked IP and a resolved location,
 *     marks the session making the request, and never carries a row id (an
 *     old row id is that session's cookie) or a full IP;
 *   - "sign out everywhere" ends every other credential and the ended ones
 *     stop authenticating on their next request, while the caller's own
 *     credential keeps working, whether it is a cookie or a device login;
 *   - it withdraws unaccepted invitations, lists the live accepted grants it
 *     left standing, and revokes share links unless asked to keep them;
 *   - the single revoke takes the opaque handle from the list, reaches only
 *     the caller's own rows, and the revoked session is signed out.
 *
 * The location resolver's online provider is the one process boundary
 * replaced: `safeFetch` answers a canned provider body, so no address leaves
 * the test.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET } from "@/app/api/auth/me/sessions/route";
import { DELETE as DELETE_ONE } from "@/app/api/auth/me/sessions/[id]/route";
import { hashToken } from "@/lib/auth/hmac";
import { sessionHandle } from "@/lib/auth/session";
import type { User } from "@/generated/prisma/client";

import { anonymous, callRoute } from "../../kit/call-route";
import {
  makeGrant,
  makeSession,
  makeToken,
  makeUser,
  uniqueSuffix,
  type BearerFixture,
  type SessionFixture,
} from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

vi.mock("@/lib/safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/safe-fetch")>();
  return {
    ...actual,
    safeFetch: vi.fn(async (input: string | URL) => {
      if (String(input).startsWith("https://ipwho.is/")) {
        return new Response(
          JSON.stringify({ success: true, city: "Berlin", country_code: "DE" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new actual.SafeFetchError("offline in this file", "network");
    }),
  };
});

const prisma = getPrismaClient();

const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36";

type SessionRow = {
  id: string;
  device: string;
  ipMasked: string | null;
  location: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  isCurrent: boolean;
};

type SignOutResult = {
  sessionsRevoked: number;
  accessTokensRevoked: number;
  connectorsRevoked: number;
  shareLinksRevoked: number;
  pendingInvitesRevoked: number;
  grantsKept: Array<{
    id: string;
    account: { id: string; username: string; displayName: string | null };
    access: "READ" | "WRITE" | "MANAGE";
  }>;
};

beforeEach(async () => {
  await truncateAllTables(prisma);
});

async function listSessions(auth: SessionFixture | BearerFixture) {
  return callRoute<{ sessions: SessionRow[] }>(GET, {
    method: "GET",
    route: "/api/auth/me/sessions",
    auth,
  });
}

/** A session with the browser details a real sign-in would have stored. */
async function browserSession(
  user: Pick<User, "id">,
  details: { userAgent: string; ipAddress: string; lastActiveAt: Date | null },
): Promise<SessionFixture> {
  const session = await makeSession(user);
  await prisma.session.update({
    where: { id: session.sessionId },
    data: details,
  });
  return session;
}

/**
 * A native device login: the access token the app presents, paired with the
 * refresh row that rotates it, the shape the native sign-in mints.
 */
async function deviceLogin(
  user: Pick<User, "id">,
  deviceId: string,
): Promise<{ access: BearerFixture; refreshId: string }> {
  const access = await makeToken(user, { name: `device ${deviceId}` });
  const refresh = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256")
        .update(`refresh-${uniqueSuffix()}`)
        .digest("hex"),
      deviceId,
      accessTokenHash: hashToken(access.token),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return { access, refreshId: refresh.id };
}

async function makeShareLink(user: Pick<User, "id">) {
  return prisma.clinicianShareLink.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256")
        .update(`share-${uniqueSuffix()}`)
        .digest("hex"),
      label: "Practice visit",
      rangeStart: new Date("2026-01-01T00:00:00Z"),
      sectionsJson: { v: 2, leaves: ["WEIGHT"] },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

describe("GET /api/auth/me/sessions", () => {
  it("answers 401 without a credential", async () => {
    const res = await callRoute(GET, {
      method: "GET",
      route: "/api/auth/me/sessions",
      auth: anonymous,
    });
    expect(res.status).toBe(401);
  });

  it("lists the caller's live sessions, most recent first, labelled, masked and located, with the current one marked", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const current = await browserSession(owner, {
      userAgent: FIREFOX_MAC,
      ipAddress: "203.0.113.7",
      lastActiveAt: new Date(),
    });
    const laptop = await browserSession(owner, {
      userAgent: CHROME_WINDOWS,
      ipAddress: "198.51.100.4",
      lastActiveAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const neverActive = await browserSession(owner, {
      userAgent: CHROME_WINDOWS,
      ipAddress: "10.0.0.8",
      lastActiveAt: null,
    });
    const expired = await makeSession(owner);
    await prisma.session.update({
      where: { id: expired.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await makeSession(other);

    const res = await listSessions(current);

    expect(res.status).toBe(200);
    expect(res.data.sessions).toEqual([
      expect.objectContaining({
        id: sessionHandle(current.sessionId),
        device: "Firefox on macOS",
        ipMasked: "203.0.x.x",
        location: "Berlin, DE",
        isCurrent: true,
      }),
      expect.objectContaining({
        id: sessionHandle(laptop.sessionId),
        device: "Chrome on Windows",
        ipMasked: "198.51.x.x",
        location: "Berlin, DE",
        isCurrent: false,
      }),
      expect.objectContaining({
        id: sessionHandle(neverActive.sessionId),
        ipMasked: "10.0.x.x",
        // A private address is never sent to the resolver.
        location: null,
        lastActiveAt: null,
        isCurrent: false,
      }),
    ]);
  });

  it("never carries a session row id or a full IP address", async () => {
    // A row id minted before the secret cookie IS that session's cookie, so
    // listing it would hand out working logins for the other devices.
    const owner = await makeUser();
    const current = await browserSession(owner, {
      userAgent: FIREFOX_MAC,
      ipAddress: "203.0.113.7",
      lastActiveAt: new Date(),
    });
    const other = await browserSession(owner, {
      userAgent: CHROME_WINDOWS,
      ipAddress: "198.51.100.4",
      lastActiveAt: null,
    });

    const res = await listSessions(current);

    const serialised = JSON.stringify(res.body);
    for (const leak of [
      current.sessionId,
      other.sessionId,
      "203.0.113.7",
      "198.51.100.4",
    ]) {
      expect(serialised).not.toContain(leak);
    }
    const handles = res.data.sessions.map((s) => s.id);
    expect(new Set(handles).size).toBe(2);
  });
});

describe("DELETE /api/auth/me/sessions (sign out everywhere else)", () => {
  it("ends every other credential, keeps the caller's session, and the ended ones stop authenticating", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const current = await makeSession(owner);
    const otherBrowser = await makeSession(owner);
    const strangerSession = await makeSession(stranger);
    const connector = await makeToken(owner, {
      permissions: ["measurements:write"],
    });
    const phone = await deviceLogin(owner, "phone");
    const link = await makeShareLink(owner);

    const res = await callRoute<SignOutResult>(DELETE, {
      method: "DELETE",
      route: "/api/auth/me/sessions",
      auth: current,
    });

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      sessionsRevoked: 1,
      // The phone's paired access token, then the programmatic token.
      accessTokensRevoked: 2,
      connectorsRevoked: 0,
      shareLinksRevoked: 1,
      pendingInvitesRevoked: 0,
      grantsKept: [],
    });

    const sessions = await prisma.session.findMany({
      select: { id: true },
    });
    expect(sessions.map((s) => s.id).sort()).toEqual(
      [current.sessionId, strangerSession.sessionId].sort(),
    );
    const tokens = await prisma.apiToken.findMany({
      where: { userId: owner.id },
      select: { id: true, revoked: true },
    });
    expect(tokens.every((t) => t.revoked)).toBe(true);
    expect(tokens).toHaveLength(2);
    const refresh = await prisma.refreshToken.findUniqueOrThrow({
      where: { id: phone.refreshId },
    });
    expect(refresh.revokedAt).not.toBeNull();
    const storedLink = await prisma.clinicianShareLink.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(storedLink.revokedAt).not.toBeNull();

    expect((await listSessions(otherBrowser)).status).toBe(401);
    expect((await listSessions(phone.access)).status).toBe(401);
    expect((await listSessions(current)).status).toBe(200);
    expect((await listSessions(strangerSession)).status).toBe(200);
    // The narrow token is refused for lack of a credential now, not a scope.
    const ingest = await callRoute(GET, {
      method: "GET",
      route: "/api/auth/me/sessions",
      auth: connector,
    });
    expect(ingest.status).toBe(401);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: owner.id, action: "auth.session.revoke_others" },
    });
    expect(JSON.parse(audit.details ?? "{}")).toMatchObject({
      sessionsRevoked: 1,
      accessTokensRevoked: 2,
      shareLinksRevoked: 1,
      pendingInvitesRevoked: 0,
      grantsKept: 0,
      keepShareLinks: false,
    });
  });

  it("keeps the share links when the caller asks to", async () => {
    const owner = await makeUser();
    const current = await makeSession(owner);
    const link = await makeShareLink(owner);

    const res = await callRoute<SignOutResult>(DELETE, {
      method: "DELETE",
      route: "/api/auth/me/sessions",
      query: { keepShareLinks: "1" },
      auth: current,
    });

    expect(res.status).toBe(200);
    expect(res.data.shareLinksRevoked).toBe(0);
    const stored = await prisma.clinicianShareLink.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(stored.revokedAt).toBeNull();
  });

  it("spares a Bearer caller's own device login and ends the other devices", async () => {
    const owner = await makeUser();
    const browser = await makeSession(owner);
    const phone = await deviceLogin(owner, "phone");
    const tablet = await deviceLogin(owner, "tablet");

    const res = await callRoute<SignOutResult>(DELETE, {
      method: "DELETE",
      route: "/api/auth/me/sessions",
      auth: phone.access,
    });

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      sessionsRevoked: 1,
      accessTokensRevoked: 1,
    });

    const phoneRefresh = await prisma.refreshToken.findUniqueOrThrow({
      where: { id: phone.refreshId },
    });
    expect(phoneRefresh.revokedAt).toBeNull();
    const tabletRefresh = await prisma.refreshToken.findUniqueOrThrow({
      where: { id: tablet.refreshId },
    });
    expect(tabletRefresh.revokedAt).not.toBeNull();
    const phoneToken = await prisma.apiToken.findUniqueOrThrow({
      where: { id: phone.access.tokenId },
    });
    expect(phoneToken.revoked).toBe(false);

    expect((await listSessions(phone.access)).status).toBe(200);
    expect((await listSessions(tablet.access)).status).toBe(401);
    expect((await listSessions(browser)).status).toBe(401);
  });

  it("withdraws unaccepted invitations and lists only the live accepted grants it left standing", async () => {
    const owner = await makeUser();
    const carer = await makeUser({ displayName: "Carer" });
    const invitee = await makeUser();
    const lapsedGrantee = await makeUser();
    const current = await makeSession(owner);
    const live = await makeGrant(owner, carer, {
      acceptedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const pending = await makeGrant(owner, invitee, { acceptedAt: null });
    const lapsed = await makeGrant(owner, lapsedGrantee, {
      acceptedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2026-02-01T00:00:00Z"),
    });

    const res = await callRoute<SignOutResult>(DELETE, {
      method: "DELETE",
      route: "/api/auth/me/sessions",
      auth: current,
    });

    expect(res.status).toBe(200);
    expect(res.data.pendingInvitesRevoked).toBe(1);
    // The lapsed grant confers nothing any more and is not listed.
    expect(res.data.grantsKept).toEqual([
      {
        id: live.id,
        account: {
          id: carer.id,
          username: carer.username,
          displayName: "Carer",
        },
        access: "READ",
      },
    ]);

    const stored = await prisma.accountGrant.findMany({
      where: { id: { in: [live.id, pending.id, lapsed.id] } },
    });
    const byId = new Map(stored.map((g) => [g.id, g]));
    expect(byId.get(pending.id)?.revokedAt).not.toBeNull();
    expect(byId.get(pending.id)?.revokedBy).toBe("GRANTOR");
    expect(byId.get(live.id)?.revokedAt).toBeNull();
    expect(byId.get(lapsed.id)?.revokedAt).toBeNull();
  });
});

describe("DELETE /api/auth/me/sessions/{id}", () => {
  it("revokes one owned session by its listed handle, and that session is signed out", async () => {
    const owner = await makeUser();
    const current = await makeSession(owner);
    const laptop = await makeSession(owner);

    const listed = await listSessions(current);
    const handle = listed.data.sessions.find((s) => !s.isCurrent)?.id;
    expect(handle).toBe(sessionHandle(laptop.sessionId));

    const res = await callRoute<{ revoked: boolean }>(DELETE_ONE, {
      method: "DELETE",
      route: "/api/auth/me/sessions/{id}",
      params: { id: sessionHandle(laptop.sessionId) },
      auth: current,
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ revoked: true });
    expect(
      await prisma.session.findUnique({ where: { id: laptop.sessionId } }),
    ).toBeNull();
    expect((await listSessions(laptop)).status).toBe(401);
    expect((await listSessions(current)).status).toBe(200);
    expect(
      await prisma.auditLog.count({
        where: { userId: owner.id, action: "auth.session.revoke" },
      }),
    ).toBe(1);
  });

  it("revokes the caller's own session when it names its own handle", async () => {
    const owner = await makeUser();
    const current = await makeSession(owner);

    const res = await callRoute<{ revoked: boolean }>(DELETE_ONE, {
      method: "DELETE",
      route: "/api/auth/me/sessions/{id}",
      params: { id: sessionHandle(current.sessionId) },
      auth: current,
    });

    expect(res.status).toBe(200);
    expect((await listSessions(current)).status).toBe(401);
  });

  it("answers 404 for another account's session and leaves it signed in", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const theirs = await makeSession(other);

    const res = await callRoute(DELETE_ONE, {
      method: "DELETE",
      route: "/api/auth/me/sessions/{id}",
      params: { id: sessionHandle(theirs.sessionId) },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(404);
    expect((await listSessions(theirs)).status).toBe(200);
  });

  it("does not accept a raw session row id in place of the handle", async () => {
    const owner = await makeUser();
    const current = await makeSession(owner);
    const laptop = await makeSession(owner);

    const res = await callRoute(DELETE_ONE, {
      method: "DELETE",
      route: "/api/auth/me/sessions/{id}",
      params: { id: laptop.sessionId },
      auth: current,
    });

    expect(res.status).toBe(404);
    expect(
      await prisma.session.findUnique({ where: { id: laptop.sessionId } }),
    ).not.toBeNull();
  });

  it("answers 401 without a credential", async () => {
    const owner = await makeUser();
    const laptop = await makeSession(owner);

    const res = await callRoute(DELETE_ONE, {
      method: "DELETE",
      route: "/api/auth/me/sessions/{id}",
      params: { id: sessionHandle(laptop.sessionId) },
      auth: anonymous,
    });

    expect(res.status).toBe(401);
    expect(
      await prisma.session.findUnique({ where: { id: laptop.sessionId } }),
    ).not.toBeNull();
  });
});
