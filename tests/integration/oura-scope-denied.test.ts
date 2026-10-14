/**
 * The Oura scope note against the real schema: the sync writes the
 * collections a grant does not cover, writes nothing when the set is
 * unchanged, clears it when the grant covers everything, and the connection
 * read hands it back to the next sync.
 */
import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { encrypt } from "@/lib/crypto";

import { getPrismaClient, truncateAllTables } from "./setup";

const USER = "user-oura-scope";

beforeEach(async () => {
  const prisma = getPrismaClient();
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: {
      id: USER,
      username: "oura-scope",
      email: "oura-scope@example.test",
      ouraAccessTokenEncrypted: encrypt("acc"),
      ouraRefreshTokenEncrypted: encrypt("ref"),
    },
  });
});

async function stored() {
  const row = await getPrismaClient().user.findUnique({
    where: { id: USER },
    select: { ouraScopeDenied: true, updatedAt: true },
  });
  return row!;
}

describe("syncOuraScopeDenied", () => {
  it("stores, keeps, hands back and clears the scope gap", async () => {
    const { syncOuraScopeDenied, getOuraConnection } =
      await import("@/lib/oura/credentials");

    await syncOuraScopeDenied(USER, ["vo2max", "spo2"]);
    const first = await stored();
    expect(first.ouraScopeDenied).toEqual(["spo2", "vo2max"]);
    expect((await getOuraConnection(USER))?.scopeDenied).toEqual([
      "spo2",
      "vo2max",
    ]);

    // Same set in another order: no write.
    await syncOuraScopeDenied(USER, ["spo2", "vo2max"]);
    expect((await stored()).updatedAt).toEqual(first.updatedAt);

    await syncOuraScopeDenied(USER, []);
    expect((await stored()).ouraScopeDenied).toBeNull();
    expect((await getOuraConnection(USER))?.scopeDenied).toEqual([]);
  });
});
