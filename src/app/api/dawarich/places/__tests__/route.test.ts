/**
 * `GET /api/dawarich/places` answers the instance's places for the home-place
 * picker and stores none of them. The database is a spy that records every
 * call: the only one allowed is the read of the connection.
 *
 * Mutation check: make the route `prisma.user.update(...)` the places into
 * the prefs and the write assertion names it.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, fetchPlacesMock } = vi.hoisted(() => ({
  calls: [] as string[],
  fetchPlacesMock: vi.fn(),
}));

vi.mock("@/lib/api-handler", () => ({
  apiHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  requireAuth: vi.fn(async () => ({ user: { id: "u1" } })),
}));
vi.mock("@/lib/modules/gate", () => ({
  requireModuleEnabled: vi.fn(async () => ({ enabled: true })),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
  getEvent: () => ({ addWarning: vi.fn() }),
}));
vi.mock("@/lib/crypto", () => ({
  decrypt: (value: string) => value.replace(/^enc:/, ""),
  decryptBytes: vi.fn(),
  encryptBytes: vi.fn(),
}));
vi.mock("@/lib/dawarich/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dawarich/client")>()),
  fetchPlaces: fetchPlacesMock,
}));

/** Every delegate call is recorded as `model.method`. */
vi.mock("@/lib/db", () => {
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async () => {
            calls.push(`${model}.${method}`);
            if (model === "user" && method === "findUnique") {
              return {
                dawarichUrlEncrypted: "enc:https://dawarich.example.com",
                dawarichApiKeyEncrypted: "enc:key",
                dawarichPrefsEncrypted: null,
              };
            }
            return null;
          }),
      },
    );
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, model: string) =>
          model.startsWith("$")
            ? vi.fn(async () => {
                calls.push(model);
                return [];
              })
            : delegate(model),
      },
    ),
  };
});

import { GET } from "../route";

const WRITE =
  /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$|^\$(executeRaw|executeRawUnsafe|transaction)/;

beforeEach(() => {
  calls.length = 0;
  fetchPlacesMock.mockReset();
});

describe("GET /api/dawarich/places", () => {
  it("answers the places and writes none of them anywhere", async () => {
    fetchPlacesMock.mockResolvedValue([
      { id: 7, name: "Home" },
      { id: 9, name: "Office" },
    ]);
    const res = (await GET(
      new NextRequest("http://localhost/api/dawarich/places?q=o"),
    )) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.places).toEqual([
      { id: 7, name: "Home" },
      { id: 9, name: "Office" },
    ]);
    expect(fetchPlacesMock).toHaveBeenCalledWith(
      { baseUrl: "https://dawarich.example.com", apiKey: "key" },
      "o",
    );
    expect(calls).toEqual(["user.findUnique"]);
    expect(calls.filter((c) => WRITE.test(c))).toEqual([]);
  });

  it("says the instance is unreachable instead of failing", async () => {
    fetchPlacesMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = (await GET(
      new NextRequest("http://localhost/api/dawarich/places"),
    )) as Response;
    expect(res.status).toBe(502);
    expect((await res.json()).meta.errorCode).toBe("dawarich.unreachable");
  });
});
