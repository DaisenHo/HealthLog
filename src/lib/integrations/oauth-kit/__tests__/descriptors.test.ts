/**
 * Pins what each provider's descriptor reads and writes. The kit's own
 * behaviour is covered in `token.test.ts`; the claim here is that every
 * descriptor reads the columns its provider always used (so no connection has
 * to reconnect) and writes only while the stored refresh token is the one the
 * refresh spent.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/withings/credentials", () => ({
  getUserWithingsCredentials: vi.fn(),
}));
vi.mock("@/lib/whoop/credentials", () => ({
  getUserWhoopCredentials: vi.fn(),
}));
vi.mock("@/lib/google-health/credentials", () => ({
  getUserGoogleHealthCredentials: vi.fn(),
}));
vi.mock("@/lib/oura/credentials", () => ({
  getOuraClientCredentials: vi.fn(),
}));
vi.mock("@/lib/strava/credentials", () => ({
  getStravaClientCredentials: vi.fn(),
}));

import type { OAuthKitDb, OAuthTokenDescriptor } from "../token";
import { withingsTokenDescriptor } from "@/lib/withings/oauth-descriptor";
import { whoopTokenDescriptor } from "@/lib/whoop/oauth-descriptor";
import { googleHealthTokenDescriptor } from "@/lib/google-health/oauth-descriptor";
import { ouraTokenDescriptor } from "@/lib/oura/oauth-descriptor";
import { stravaTokenDescriptor } from "@/lib/strava/oauth-descriptor";
import { polarTokenDescriptor } from "@/lib/polar/oauth-descriptor";

function fakeDb(row: Record<string, unknown> | null) {
  const model = {
    findUnique: vi.fn(async () => row),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const db = {
    user: model,
    withingsConnection: model,
    whoopConnection: model,
    googleHealthConnection: model,
  } as unknown as OAuthKitDb;
  return { db, model };
}

const EXP = new Date("2026-10-21T13:00:00.000Z");
const NEXT = {
  accessCiphertext: "a2",
  refreshCiphertext: "r2",
  expiresAt: EXP,
};

type AnyDescriptor = OAuthTokenDescriptor<never>;

const CONNECTION_TABLES: Array<[string, AnyDescriptor]> = [
  ["withings", withingsTokenDescriptor as unknown as AnyDescriptor],
  ["whoop", whoopTokenDescriptor as unknown as AnyDescriptor],
  ["google-health", googleHealthTokenDescriptor as unknown as AnyDescriptor],
];

describe.each(CONNECTION_TABLES)("%s descriptor", (_name, d) => {
  it("reads the connection row's columns", async () => {
    const { db } = fakeDb({
      whoopUserId: "w",
      accessToken: "a1",
      refreshToken: "r1",
      tokenExpiresAt: EXP,
    });
    await expect(d.readGrant(db, "u")).resolves.toEqual({
      accessCiphertext: "a1",
      refreshCiphertext: "r1",
      expiresAt: EXP,
    });
  });

  it("writes only over the refresh token it spent", async () => {
    const { db, model } = fakeDb(null);
    await d.writeGrant(db, "u", "r1", NEXT);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { userId: "u", refreshToken: "r1" },
      data: { accessToken: "a2", refreshToken: "r2", tokenExpiresAt: EXP },
    });
  });
});

describe("whoop descriptor", () => {
  it("treats a connection without a WHOOP user id as no grant", async () => {
    const { db } = fakeDb({
      whoopUserId: null,
      accessToken: "a1",
      refreshToken: "r1",
      tokenExpiresAt: EXP,
    });
    await expect(whoopTokenDescriptor.readGrant(db, "u")).resolves.toBeNull();
  });
});

const USER_COLUMNS: Array<[string, AnyDescriptor, string]> = [
  ["oura", ouraTokenDescriptor as unknown as AnyDescriptor, "oura"],
  ["strava", stravaTokenDescriptor as unknown as AnyDescriptor, "strava"],
];

describe.each(USER_COLUMNS)("%s descriptor", (_name, d, prefix) => {
  it("reads the User columns, with no expiry", async () => {
    const { db } = fakeDb({
      [`${prefix}AccessTokenEncrypted`]: "a1",
      [`${prefix}RefreshTokenEncrypted`]: "r1",
    });
    await expect(d.readGrant(db, "u")).resolves.toEqual({
      accessCiphertext: "a1",
      refreshCiphertext: "r1",
      expiresAt: null,
    });
    expect(d.tracksExpiry).toBe(false);
  });

  it("reads no grant when either token is missing", async () => {
    const { db } = fakeDb({ [`${prefix}AccessTokenEncrypted`]: "a1" });
    await expect(d.readGrant(db, "u")).resolves.toBeNull();
  });

  it("writes only over the refresh token it spent", async () => {
    const { db, model } = fakeDb(null);
    await d.writeGrant(db, "u", "r1", NEXT);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: "u", [`${prefix}RefreshTokenEncrypted`]: "r1" },
      data: {
        [`${prefix}AccessTokenEncrypted`]: "a2",
        [`${prefix}RefreshTokenEncrypted`]: "r2",
      },
    });
  });
});

describe("polar descriptor", () => {
  it("reads a token with nothing to refresh", async () => {
    const { db } = fakeDb({ polarAccessTokenEncrypted: "a1" });
    await expect(polarTokenDescriptor.readGrant(db, "u")).resolves.toEqual({
      accessCiphertext: "a1",
      refreshCiphertext: null,
      expiresAt: null,
    });
    expect(polarTokenDescriptor.refresh).toBeNull();
  });
});
