import { beforeEach, describe, expect, it, vi } from "vitest";

// The unit setup stubs the meter for every route test; this file is where the
// real one is pinned.
vi.mock("@/lib/auth/write-meter", async (importOriginal) =>
  importOriginal<typeof import("@/lib/auth/write-meter")>(),
);

const state = vi.hoisted(() => ({
  event: null as null | { getHttpMethod: () => string | undefined },
  allowed: true,
}));

vi.mock("@/lib/logging/context", () => ({
  getEvent: () => state.event,
  annotate: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRecordWriteRateLimit: vi.fn(async () => ({
    allowed: state.allowed,
    limit: 300,
    remaining: state.allowed ? 299 : 0,
    resetAt: Date.now() + 60_000,
  })),
}));

import {
  meterAccountWrite,
  RECORD_WRITE_RATE_LIMITED_CODE,
} from "../write-meter";
import { checkRecordWriteRateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/api-errors";

function request(method: string | undefined) {
  state.event = { getHttpMethod: () => method };
}

beforeEach(() => {
  vi.mocked(checkRecordWriteRateLimit).mockClear();
  state.allowed = true;
  state.event = null;
});

describe("meterAccountWrite", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "patch"])(
    "charges the acting account for a %s",
    async (method) => {
      request(method);
      await meterAccountWrite("account-1");
      expect(checkRecordWriteRateLimit).toHaveBeenCalledWith("account-1");
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])("leaves a %s alone", async (method) => {
    request(method);
    await meterAccountWrite("account-1");
    expect(checkRecordWriteRateLimit).not.toHaveBeenCalled();
  });

  it("charges nothing outside a request", async () => {
    await meterAccountWrite("account-1");
    expect(checkRecordWriteRateLimit).not.toHaveBeenCalled();
  });

  it("charges one request once, however many resolvers it passes", async () => {
    request("POST");
    await meterAccountWrite("account-1");
    await meterAccountWrite("account-1");
    expect(checkRecordWriteRateLimit).toHaveBeenCalledTimes(1);

    request("POST");
    await meterAccountWrite("account-1");
    expect(checkRecordWriteRateLimit).toHaveBeenCalledTimes(2);
  });

  it("leaves a read-over-POST alone, and only the POST", async () => {
    request("POST");
    await meterAccountWrite("account-1", { readOverPost: true });
    expect(checkRecordWriteRateLimit).not.toHaveBeenCalled();
    request("DELETE");
    await meterAccountWrite("account-1", { readOverPost: true });
    expect(checkRecordWriteRateLimit).toHaveBeenCalledTimes(1);
  });

  it("leaves a route with its own bucket alone", async () => {
    request("POST");
    await meterAccountWrite("account-1", { writeBucket: "own" });
    expect(checkRecordWriteRateLimit).not.toHaveBeenCalled();
  });

  it("refuses a spent bucket with 429 and the published code", async () => {
    state.allowed = false;
    request("PATCH");
    const refusal = await meterAccountWrite("account-1").catch((e) => e);
    expect(refusal).toBeInstanceOf(HttpError);
    expect((refusal as HttpError).statusCode).toBe(429);
    expect((refusal as HttpError).errorCode).toBe(
      RECORD_WRITE_RATE_LIMITED_CODE,
    );
  });
});
