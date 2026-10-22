/**
 * The route kit's contract check, proven able to fail.
 *
 * Every kit test leans on `callRoute` refusing a response the published
 * contract does not describe. A check that passes whatever it is handed would
 * turn every one of them into a weaker test than it claims to be, so each
 * refusal is exercised here against a handler that answers exactly the wrong
 * thing, wrapped in the real `apiHandler`.
 */
import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { apiHandler } from "@/lib/api-handler";

import { ContractViolation, anonymous, callRoute } from "../../kit/call-route";

const token = {
  id: "tok-1",
  name: "phone",
  permissions: ["*"],
  lastUsedAt: null,
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  revoked: false,
};

function answering(status: number, body: unknown) {
  return apiHandler(async () => NextResponse.json(body, { status }));
}

describe("callRoute's contract check", () => {
  it("accepts a body the registered schema describes", async () => {
    const res = await callRoute(
      answering(200, { data: [token], error: null }),
      {
        method: "GET",
        route: "/api/tokens",
        auth: anonymous,
      },
    );
    expect(res.status).toBe(200);
  });

  it("refuses a key the registered schema does not declare", async () => {
    await expect(
      callRoute(
        answering(200, {
          data: [{ ...token, tokenHash: "abc" }],
          error: null,
        }),
        { method: "GET", route: "/api/tokens", auth: anonymous },
      ),
    ).rejects.toThrow(/does not declare: data\[0\]\.tokenHash/);
  });

  it("refuses a body of the wrong shape", async () => {
    await expect(
      callRoute(
        answering(200, { data: [{ ...token, revoked: "no" }], error: null }),
        {
          method: "GET",
          route: "/api/tokens",
          auth: anonymous,
        },
      ),
    ).rejects.toBeInstanceOf(ContractViolation);
  });

  it("refuses a status the operation does not declare", async () => {
    await expect(
      callRoute(answering(409, { data: null, error: "conflict" }), {
        method: "GET",
        route: "/api/tokens",
        auth: anonymous,
      }),
    ).rejects.toThrow(/answered 409, which the contract does not declare/);
  });

  it("refuses a 403 that is not the generic scope refusal", async () => {
    await expect(
      callRoute(
        answering(403, {
          data: null,
          error: "nope",
          meta: { errorCode: "http.forbidden" },
        }),
        { method: "GET", route: "/api/tokens", auth: anonymous },
      ),
    ).rejects.toThrow(/answered 403/);
  });

  it("refuses a route the registry does not know", async () => {
    await expect(
      callRoute(answering(200, { data: null, error: null }), {
        method: "GET",
        route: "/api/not-a-route",
        auth: anonymous,
      }),
    ).rejects.toThrow(/is not in the OpenAPI registry/);
  });

  it("skips the check only when told why", async () => {
    const res = await callRoute(answering(200, { anything: true }), {
      method: "GET",
      route: "/api/not-a-route",
      auth: anonymous,
      contract: { skip: "exercising the escape hatch itself" },
    });
    expect(res.body).toEqual({ anything: true });
  });
});
