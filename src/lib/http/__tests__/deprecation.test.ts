import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));

import { annotate } from "@/lib/logging/context";
import { buildOpenApiDocument } from "@/lib/openapi/registry";

import { clientBuildOf, deprecated, DEPRECATIONS } from "../deprecation";

beforeEach(() => vi.mocked(annotate).mockClear());

function request(userAgent?: string): Request {
  return new Request("http://localhost/api/feature-flags", {
    headers: userAgent ? { "user-agent": userAgent } : {},
  });
}

describe("deprecated()", () => {
  it("dates the deprecation and the sunset, and names the successor", () => {
    const res = deprecated(
      new Response(null, { headers: { Link: '</a>; rel="next"' } }),
      "/api/feature-flags",
      request(),
    );
    const notice = DEPRECATIONS["/api/feature-flags"];
    expect(res.headers.get("Deprecation")).toBe(
      `@${Date.parse(`${notice.since}T00:00:00Z`) / 1000}`,
    );
    expect(new Date(res.headers.get("Sunset")!).toISOString()).toBe(
      `${notice.sunset}T00:00:00.000Z`,
    );
    // A Link the route already set survives beside the successor.
    expect(res.headers.get("Link")).toBe(
      '</a>; rel="next", </api/auth/me>; rel="successor-version"',
    );
  });

  it("logs which client build still asked", () => {
    deprecated(
      new Response(null),
      "/api/feature-flags",
      request("HealthLog-iOS/1.2.0 (dev.healthlog.app)"),
    );
    expect(annotate).toHaveBeenCalledWith({
      meta: {
        deprecated_route: "/api/feature-flags",
        deprecation_sunset: DEPRECATIONS["/api/feature-flags"].sunset,
        client_build: "ios/1.2.0",
      },
    });
  });

  it("sunsets every notice after it was deprecated", () => {
    for (const notice of Object.values(DEPRECATIONS)) {
      expect(Date.parse(notice.sunset)).toBeGreaterThan(
        Date.parse(notice.since),
      );
    }
  });
});

describe("clientBuildOf", () => {
  it("reads the native build, a browser, anything else, and nothing", () => {
    expect(clientBuildOf("HealthLog-iOS/1.3.0 (dev.healthlog.app)")).toBe(
      "ios/1.3.0",
    );
    expect(
      clientBuildOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
    ).toBe("web");
    expect(clientBuildOf("curl/8.4.0")).toBe("other");
    expect(clientBuildOf(null)).toBeNull();
  });
});

describe("each deprecation is published and applied", () => {
  const doc = buildOpenApiDocument() as unknown as {
    paths: Record<string, Record<string, { deprecated?: boolean }>>;
  };

  it.each(Object.keys(DEPRECATIONS))(
    "%s is deprecated in the contract and answers through the helper",
    (route) => {
      const ops = Object.values(doc.paths[route] ?? {});
      expect(ops.length).toBeGreaterThan(0);
      expect(ops.every((op) => op.deprecated === true)).toBe(true);
      const src = readFileSync(
        join(process.cwd(), "src/app", route, "route.ts"),
        "utf8",
      );
      expect(src).toContain(`deprecated(response, "${route}", request)`);
    },
  );
});
