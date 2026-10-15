/**
 * An incoming `x-request-id` is client-controlled. It is echoed on the
 * response and written into every log line of the request, so it is adopted
 * only when it is a plain correlation token — `^[A-Za-z0-9-]{8,64}$` — and
 * replaced with a fresh id otherwise. Both places that read it are covered:
 * the proxy (every proxied path) and `apiHandler` (which also serves the
 * routes the proxy matcher leaves out).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/process-type", () => ({
  shouldRunWeb: () => true,
  shouldRunWorker: () => true,
  getProcessType: () => "all",
}));

import { proxy } from "../proxy";
import { apiHandler } from "@/lib/api-handler";
import { getEvent } from "@/lib/logging/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const VALID = ["3f9a2c1b", "abcDEF12-3456-7890", "a".repeat(64)];
const INVALID = [
  "short",
  "a".repeat(65),
  "id with spaces",
  "id_underscore_x",
  "<script>alert(1)</script>",
  'x" level="error',
  "ümläut-id-1234",
];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function proxied(requestId: string): NextRequest {
  return new NextRequest("http://localhost/api/version", {
    headers: { "x-request-id": requestId },
  });
}

describe("proxy: incoming x-request-id", () => {
  it.each(VALID)("adopts the well-formed id %s", (id) => {
    const res = proxy(proxied(id));
    expect(res.headers.get("x-request-id")).toBe(id);
  });

  it.each(INVALID)("replaces the malformed id %j with a fresh one", (id) => {
    const res = proxy(proxied(id));
    const echoed = res.headers.get("x-request-id");
    expect(echoed).not.toBe(id);
    expect(echoed).toMatch(UUID);
    // The rewritten request header the route sees carries the same fresh id.
    expect(res.headers.get("x-middleware-request-x-request-id")).toBe(echoed);
  });
});

describe("apiHandler: incoming x-request-id", () => {
  function call(id: string) {
    let logged: string | undefined;
    const wrapped = apiHandler(async (_request: NextRequest) => {
      logged = getEvent()?.getRequestId();
      return NextResponse.json({ data: "ok" });
    });
    return wrapped(
      new NextRequest("http://localhost/api/measurements/batch", {
        method: "POST",
        headers: { "x-request-id": id },
      }),
    ).then((res) => ({ res, logged }));
  }

  it.each(VALID)("logs and echoes the well-formed id %s", async (id) => {
    const { res, logged } = await call(id);
    expect(logged).toBe(id);
    expect(res.headers.get("x-request-id")).toBe(id);
  });

  it.each(INVALID)("never logs or echoes the malformed id %j", async (id) => {
    const { res, logged } = await call(id);
    expect(logged).not.toBe(id);
    expect(logged).toMatch(UUID);
    expect(res.headers.get("x-request-id")).toBe(logged);
  });
});
