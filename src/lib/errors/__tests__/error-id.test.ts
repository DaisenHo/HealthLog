import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The node test environment has no `window`; a session storage stand-in is
// all this module touches.
const store = new Map<string, string>();
const sessionStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};
vi.stubGlobal("window", { sessionStorage });
afterAll(() => {
  vi.unstubAllGlobals();
});

import { ApiError } from "@/lib/api/api-fetch";
import {
  _resetRecentErrorIdsForTests,
  errorIdOf,
  recentErrorIds,
  recordErrorId,
  RECENT_ERROR_IDS_MAX,
  shortErrorId,
} from "../error-id";

const ID = "3f9a2c1b-0000-4000-8000-000000000001";

beforeEach(() => {
  _resetRecentErrorIdsForTests();
});

describe("errorIdOf", () => {
  it("shows a server failure's request id and keeps a 4xx quiet", () => {
    expect(errorIdOf(new ApiError("boom", 500, { requestId: ID }))).toBe(ID);
    expect(errorIdOf(new ApiError("no", 404, { requestId: ID }))).toBeNull();
    expect(errorIdOf(new ApiError("boom", 503, undefined, ID))).toBe(ID);
    expect(errorIdOf(new ApiError("boom", 500))).toBeNull();
  });

  it("shows a 4xx too once it reached an error boundary", () => {
    expect(
      errorIdOf(new ApiError("no", 404, { requestId: ID }), {
        unexpected: true,
      }),
    ).toBe(ID);
  });

  it("prefers meta.requestId over the header", () => {
    const error = new ApiError("boom", 500, { requestId: ID }, "header-0001");
    expect(error.requestId).toBe(ID);
  });

  it("reads the header of a raw Response", () => {
    const res = new Response("x", {
      status: 502,
      headers: { "x-request-id": ID },
    });
    expect(errorIdOf(res)).toBe(ID);
    expect(
      errorIdOf(
        new Response("x", { status: 409, headers: { "x-request-id": ID } }),
      ),
    ).toBeNull();
  });

  it("falls back to a render digest and to nothing", () => {
    const rendered = Object.assign(new Error("render"), {
      digest: "123456789",
    });
    expect(errorIdOf(rendered)).toBe("123456789");
    expect(errorIdOf(new TypeError("Failed to fetch"))).toBeNull();
    expect(errorIdOf(undefined)).toBeNull();
    expect(errorIdOf("text")).toBeNull();
  });

  it("shows the first 8 characters", () => {
    expect(shortErrorId(ID)).toBe("3f9a2c1b");
  });
});

describe("recent error ids", () => {
  it("keeps the newest five, newest first, without repeats", () => {
    for (let i = 0; i < 7; i++) recordErrorId(`id-0000-${i}`);
    recordErrorId("id-0000-5");
    const ids = recentErrorIds();
    expect(ids).toHaveLength(RECENT_ERROR_IDS_MAX);
    expect(ids[0]).toBe("id-0000-5");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("id-0000-0");
  });

  it("survives a reload through session storage", () => {
    recordErrorId(ID);
    expect(
      JSON.parse(sessionStorage.getItem("healthlog-recent-error-ids")!),
    ).toEqual([ID]);
  });
});
