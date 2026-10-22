import { beforeEach, describe, expect, it, vi } from "vitest";

const { lock } = vi.hoisted(() => ({ lock: vi.fn(async () => undefined) }));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ tx: true }),
  },
}));
vi.mock("@/lib/crypto", () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\((.*)\)$/, "$1"),
}));
vi.mock("@/lib/integrations/oauth-refresh", () => ({
  acquireProviderTokenRefreshLock: lock,
  PROVIDER_REFRESH_TRANSACTION_OPTIONS: {},
}));

import {
  obtainAccessToken,
  type NextGrant,
  type OAuthTokenDescriptor,
  type StoredGrant,
} from "../token";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");

function harness(opts: {
  grant: StoredGrant | null;
  tracksExpiry?: boolean;
  refresh?: OAuthTokenDescriptor<string>["refresh"];
  creds?: string | null;
}) {
  let stored = opts.grant;
  const writes: NextGrant[] = [];
  const reads: Array<StoredGrant | null> = [];
  const descriptor: OAuthTokenDescriptor<string> = {
    provider: "withings",
    tracksExpiry: opts.tracksExpiry ?? true,
    expiryBufferMs: 5 * 60 * 1000,
    readGrant: async () => {
      reads.push(stored);
      return stored;
    },
    writeGrant: async (_db, _user, spent, next) => {
      if (!stored || stored.refreshCiphertext !== spent) return 0;
      writes.push(next);
      stored = next;
      return 1;
    },
    loadCredentials: async () =>
      opts.creds === undefined ? "creds" : opts.creds,
    refresh:
      opts.refresh === undefined
        ? vi.fn(async () => ({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }))
        : opts.refresh,
  };
  return {
    descriptor,
    writes,
    reads,
    replace(g: StoredGrant | null) {
      stored = g;
    },
  };
}

const grant = (over: Partial<StoredGrant> = {}): StoredGrant => ({
  accessCiphertext: "enc(old-access)",
  refreshCiphertext: "enc(old-refresh)",
  expiresAt: new Date(NOW + 60 * 60 * 1000),
  ...over,
});

beforeEach(() => lock.mockClear());

describe("obtainAccessToken", () => {
  it("answers none without a stored grant", async () => {
    const h = harness({ grant: null });
    await expect(
      obtainAccessToken(h.descriptor, "u", { now: () => NOW }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("returns a fresh token without taking the lock", async () => {
    const h = harness({ grant: grant() });
    const res = await obtainAccessToken(h.descriptor, "u", { now: () => NOW });
    expect(res).toMatchObject({ kind: "token", accessToken: "old-access" });
    expect(lock).not.toHaveBeenCalled();
    expect(h.descriptor.refresh).not.toHaveBeenCalled();
  });

  it("refreshes a stale token under the lock and writes both tokens", async () => {
    const h = harness({ grant: grant({ expiresAt: new Date(NOW + 1000) }) });
    const res = await obtainAccessToken(h.descriptor, "u", { now: () => NOW });
    expect(lock).toHaveBeenCalledWith({ tx: true }, "withings", "u");
    expect(res).toMatchObject({
      kind: "token",
      accessToken: "new-access",
      refreshed: true,
    });
    expect(h.writes).toEqual([
      {
        accessCiphertext: "enc(new-access)",
        refreshCiphertext: "enc(new-refresh)",
        expiresAt: new Date(NOW + 3600 * 1000),
      },
    ]);
  });

  it("keeps the stored refresh token when the response carries none", async () => {
    const h = harness({
      grant: grant({ expiresAt: new Date(NOW - 1) }),
      refresh: vi.fn(async () => ({ access_token: "a2", expires_in: 60 })),
    });
    await obtainAccessToken(h.descriptor, "u", { now: () => NOW });
    expect(h.writes[0]?.refreshCiphertext).toBe("enc(old-refresh)");
  });

  it("uses a peer's refresh it finds under the lock instead of spending the token again", async () => {
    const stale = grant({ expiresAt: new Date(NOW - 1) });
    const h = harness({ grant: stale });
    // The peer commits between the first read and the read under the lock.
    let first = true;
    const read = h.descriptor.readGrant;
    h.descriptor.readGrant = async (db, user) => {
      const g = await read(db, user);
      if (first) {
        first = false;
        h.replace(
          grant({
            accessCiphertext: "enc(peer-access)",
            refreshCiphertext: "enc(peer-refresh)",
          }),
        );
      }
      return g;
    };
    const res = await obtainAccessToken(h.descriptor, "u", { now: () => NOW });
    expect(res).toMatchObject({ accessToken: "peer-access", refreshed: false });
    expect(h.descriptor.refresh).not.toHaveBeenCalled();
  });

  it("after a refusal refreshes once, and a later refusal of the same token reuses the result", async () => {
    const h = harness({
      grant: grant({ expiresAt: null }),
      tracksExpiry: false,
    });
    const a = await obtainAccessToken(h.descriptor, "u", {
      afterRefusalOf: "enc(old-refresh)",
      now: () => NOW,
    });
    const b = await obtainAccessToken(h.descriptor, "u", {
      afterRefusalOf: "enc(old-refresh)",
      now: () => NOW,
    });
    expect(a).toMatchObject({ accessToken: "new-access", refreshed: true });
    expect(b).toMatchObject({ accessToken: "new-access", refreshed: false });
    expect(h.descriptor.refresh).toHaveBeenCalledTimes(1);
    expect(h.writes[0]?.expiresAt).toBeNull();
  });

  it("lets a reconnect that lands during the refresh win", async () => {
    const h = harness({ grant: grant({ expiresAt: new Date(NOW - 1) }) });
    h.descriptor = {
      ...h.descriptor,
      refresh: vi.fn(async () => {
        h.replace(
          grant({
            accessCiphertext: "enc(reconnected)",
            refreshCiphertext: "enc(reconnected-refresh)",
          }),
        );
        return { access_token: "late", refresh_token: "late-r", expires_in: 1 };
      }),
    };
    const res = await obtainAccessToken(h.descriptor, "u", { now: () => NOW });
    expect(res).toMatchObject({ accessToken: "reconnected", refreshed: false });
    expect(h.writes).toEqual([]);
  });

  it("answers no_credentials when the client is gone", async () => {
    const h = harness({
      grant: grant({ expiresAt: new Date(NOW - 1) }),
      creds: null,
    });
    await expect(
      obtainAccessToken(h.descriptor, "u", { now: () => NOW }),
    ).resolves.toEqual({ kind: "no_credentials" });
  });

  it("never refreshes for a provider without refresh tokens", async () => {
    const h = harness({
      grant: grant({ refreshCiphertext: null, expiresAt: null }),
      tracksExpiry: false,
      refresh: null,
    });
    const res = await obtainAccessToken(h.descriptor, "u", {
      force: true,
      now: () => NOW,
    });
    expect(res).toMatchObject({ kind: "token", accessToken: "old-access" });
    expect(lock).not.toHaveBeenCalled();
  });

  it("rethrows the provider's refusal untouched", async () => {
    const boom = new Error("invalid_grant");
    const h = harness({
      grant: grant({ expiresAt: new Date(NOW - 1) }),
      refresh: vi.fn(async () => {
        throw boom;
      }),
    });
    await expect(
      obtainAccessToken(h.descriptor, "u", { now: () => NOW }),
    ).rejects.toBe(boom);
    expect(h.writes).toEqual([]);
  });
});
