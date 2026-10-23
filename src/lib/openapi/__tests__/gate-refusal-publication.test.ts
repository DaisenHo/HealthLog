/**
 * The generic auth gate's 403, declared on every operation that passes it.
 *
 * `requireAuth` answers 403 `auth.scope.insufficient` to a narrow Bearer token
 * on a route that names no scope it holds, and `requireAdmin` answers 403
 * `auth.admin.required` to a session that is not an administrator's. Both run
 * before a route's own body, so every operation behind them can send the
 * status; `withScopeRefusal` declares it on the assembled table. These checks
 * hold the published document to that, and hold the helper to not trampling
 * the 403s operations already publish for reasons of their own.
 */
import { describe, expect, it } from "vitest";

import { openApiPaths } from "../routes";
import {
  adminRefusalResponse,
  errorEnvelope,
  scopeRefusalResponse,
  stdResponses,
  withScopeRefusal,
} from "../routes/shared";

const METHODS = ["get", "put", "post", "patch", "delete"] as const;

interface Op {
  security?: unknown[];
  responses?: Record<string, { description?: string } | undefined>;
}

function operations(): Array<{ path: string; method: string; op: Op }> {
  const out: Array<{ path: string; method: string; op: Op }> = [];
  for (const [path, item] of Object.entries(openApiPaths)) {
    for (const method of METHODS) {
      const op = (item as Record<string, Op | undefined>)[method];
      if (op?.responses) out.push({ path, method, op });
    }
  }
  return out;
}

const URL_CREDENTIAL_OR_OWN_GATE = new Set([
  "/api/c/{token}/unlock",
  "/api/notifications/action/{token}",
  "/api/ingest/medication",
]);

describe("the gate's 403 in the published contract", () => {
  it("is declared, naming its code, on every operation behind the gate", () => {
    const behind = operations().filter(
      ({ path, op }) =>
        op.responses?.["401"] &&
        !(Array.isArray(op.security) && op.security.length === 0) &&
        !URL_CREDENTIAL_OR_OWN_GATE.has(path),
    );
    expect(behind.length).toBeGreaterThan(500);

    const silent = behind.filter(({ path, op }) => {
      const code = path.startsWith("/api/admin/")
        ? "auth.admin.required"
        : "auth.scope.insufficient";
      return !op.responses?.["403"]?.description?.includes(code);
    });
    expect(silent.map(({ path, method }) => `${method} ${path}`)).toEqual([]);
  });

  it("is not declared on an operation that takes no credential", () => {
    const open = operations().filter(
      ({ op }) => Array.isArray(op.security) && op.security.length === 0,
    );
    expect(open.length).toBeGreaterThan(0);
    const claimed = open.filter(({ op }) =>
      op.responses?.["403"]?.description?.includes("auth.scope.insufficient"),
    );
    expect(claimed.map(({ path, method }) => `${method} ${path}`)).toEqual([]);
  });

  it("keeps an operation's own 403 and its wording", () => {
    const calendar = (
      openApiPaths["/api/cycle/calendar"] as unknown as {
        get: Op;
      }
    ).get;
    const description = calendar.responses?.["403"]?.description ?? "";
    expect(description).toContain("cycle.disabled");
    expect(description).toContain("auth.scope.insufficient");
  });
});

describe("withScopeRefusal", () => {
  const ownForbidden = {
    description: "Module off. `meta.errorCode` = `module.disabled`.",
    content: { "application/json": { schema: errorEnvelope } },
  };
  const table = withScopeRefusal({
    "/api/a": {
      get: { responses: { "200": {}, ...stdResponses } },
      post: { responses: { "200": {}, ...stdResponses, "403": ownForbidden } },
    },
    "/api/b": {
      get: { responses: { "200": {}, "403": ownForbidden, ...stdResponses } },
    },
    "/api/admin/x": { get: { responses: { "200": {}, ...stdResponses } } },
    "/api/open": {
      get: { security: [], responses: { "200": {}, ...stdResponses } },
    },
    "/api/no-auth-declared": { get: { responses: { "200": {} } } },
  }) as unknown as Record<string, Record<string, Op>>;

  it("adds the shared response where an operation has none", () => {
    expect(table["/api/a"].get.responses?.["403"]).toBe(scopeRefusalResponse);
    expect(table["/api/admin/x"].get.responses?.["403"]).toBe(
      adminRefusalResponse,
    );
  });

  it("prefixes an own 403, once per shared object, and leaves its text", () => {
    const a = table["/api/a"].post.responses?.["403"];
    const b = table["/api/b"].get.responses?.["403"];
    expect(a).toBe(b);
    expect(a?.description?.startsWith("`meta.errorCode` = `auth.scope")).toBe(
      true,
    );
    expect(a?.description?.endsWith(ownForbidden.description)).toBe(true);
    // The input object is not mutated.
    expect(ownForbidden.description).not.toContain("auth.scope");
  });

  it("leaves an operation that takes no credential or declares no 401 alone", () => {
    expect(table["/api/open"].get.responses?.["403"]).toBeUndefined();
    expect(
      table["/api/no-auth-declared"].get.responses?.["403"],
    ).toBeUndefined();
  });
});
