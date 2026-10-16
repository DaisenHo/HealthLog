import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/hmac", () => ({ hashToken: vi.fn() }));
vi.mock("@/lib/auth/audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));
vi.mock("@/lib/monitoring/glitchtip", () => ({
  sendGlitchtipEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

import { NextRequest, NextResponse } from "next/server";
import { apiHandler, HttpError } from "@/lib/api-handler";
import { apiError, apiSuccess, withErrorRequestId } from "@/lib/api-response";

const INCOMING = "3f9a2c1b-0000-4000-8000-000000000001";

function call(
  handler: () => Promise<Response>,
  headers: Record<string, string> = {},
) {
  const route = apiHandler(async (_request: NextRequest) => handler());
  return route(new NextRequest("http://localhost/api/probe", { headers }));
}

describe("meta.requestId on every error envelope", () => {
  it("adds the request id to an apiError envelope, equal to the header", async () => {
    const res = await call(async () =>
      apiError("Nope", 409, { errorCode: "probe.conflict" }),
    );
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.meta.errorCode).toBe("probe.conflict");
    expect(body.meta.requestId).toBe(res.headers.get("x-request-id"));
    expect(body.meta.requestId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it("adds it to an envelope without meta and to a hand-built one", async () => {
    const plain = await call(async () => apiError("Not found", 404));
    expect((await plain.json()).meta).toEqual({
      requestId: plain.headers.get("x-request-id"),
    });
    const hand = await call(async () =>
      NextResponse.json({ data: null, error: "Gone" }, { status: 410 }),
    );
    expect((await hand.json()).meta.requestId).toBe(
      hand.headers.get("x-request-id"),
    );
  });

  it("adds it to a thrown HttpError and to an unexpected throw (500)", async () => {
    const thrown = await call(async () => {
      throw new HttpError(403, "Forbidden");
    });
    expect((await thrown.json()).meta.requestId).toBe(
      thrown.headers.get("x-request-id"),
    );
    const crash = await call(async () => {
      throw new Error("boom");
    });
    expect(crash.status).toBe(500);
    expect((await crash.json()).meta.requestId).toBe(
      crash.headers.get("x-request-id"),
    );
  });

  it("adopts a well-formed incoming x-request-id and replaces a malformed one", async () => {
    const adopted = await call(async () => apiError("Nope", 400), {
      "x-request-id": INCOMING,
    });
    expect((await adopted.json()).meta.requestId).toBe(INCOMING);
    expect(adopted.headers.get("x-request-id")).toBe(INCOMING);

    const forged = '<script>"x"</script>';
    const replaced = await call(async () => apiError("Nope", 400), {
      "x-request-id": forged,
    });
    const id = (await replaced.json()).meta.requestId;
    expect(id).not.toBe(forged);
    expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(replaced.headers.get("x-request-id")).toBe(id);
  });

  it("keeps status, headers and set-cookie on the rewritten response", async () => {
    const res = await call(async () => {
      const r = apiError("Slow down", 429, {
        headers: { "Retry-After": "30" },
      });
      r.cookies.set("probe", "1");
      return r;
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("set-cookie")).toContain("probe=1");
  });

  it("leaves a success, a non-envelope error and a non-JSON error untouched", async () => {
    const ok = await call(async () => apiSuccess({ fine: true }));
    expect(await ok.json()).toEqual({ data: { fine: true }, error: null });

    const rpc = await call(async () =>
      NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32600, message: "bad" }, id: 1 },
        { status: 400 },
      ),
    );
    expect(await rpc.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32600, message: "bad" },
      id: 1,
    });

    const text = await call(
      async () => new Response("plain failure", { status: 502 }),
    );
    expect(await text.text()).toBe("plain failure");
  });

  it("never overwrites an id the handler set itself", async () => {
    const res = await withErrorRequestId(
      NextResponse.json(
        { data: null, error: "x", meta: { requestId: "kept-by-handler" } },
        { status: 500 },
      ),
      "ignored-0000",
    );
    expect((await res.json()).meta.requestId).toBe("kept-by-handler");
  });
});
