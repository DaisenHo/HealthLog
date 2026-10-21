import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const updateMany = vi.fn();
const getStravaCredentials = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: (cipher: string) => `dec(${cipher})`,
  encrypt: (plain: string) => `enc(${plain})`,
}));

vi.mock("../client", () => ({
  getStravaCredentials: () => getStravaCredentials(),
}));

import { getStravaClientCredentials } from "../credentials";

describe("getStravaClientCredentials — DB-first then env", () => {
  beforeEach(() => {
    findUnique.mockReset();
    getStravaCredentials.mockReset();
  });

  it("returns the per-user BYO pair when both columns are set", async () => {
    findUnique.mockResolvedValue({
      stravaClientIdEncrypted: "enc-id",
      stravaClientSecretEncrypted: "enc-secret",
    });
    const creds = await getStravaClientCredentials("user-1");
    expect(creds).toEqual({
      clientId: "dec(enc-id)",
      clientSecret: "dec(enc-secret)",
    });
    expect(getStravaCredentials).not.toHaveBeenCalled();
  });

  it("falls back to the shared env app when the user has no BYO pair", async () => {
    findUnique.mockResolvedValue({
      stravaClientIdEncrypted: null,
      stravaClientSecretEncrypted: null,
    });
    getStravaCredentials.mockReturnValue({
      clientId: "env-id",
      clientSecret: "env-secret",
    });
    const creds = await getStravaClientCredentials("user-1");
    expect(creds).toEqual({ clientId: "env-id", clientSecret: "env-secret" });
    expect(getStravaCredentials).toHaveBeenCalledOnce();
  });
});
