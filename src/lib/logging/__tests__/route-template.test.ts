import { describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";

import { routeTemplateFor, templatePath } from "../route-template";
import { apiHandler } from "@/lib/api-handler";
import { apiSuccess } from "@/lib/api-response";
import { emitIfSampled } from "@/lib/logging/transports";

describe("templatePath", () => {
  it("puts a single param's name back in place of its value", () => {
    expect(templatePath("/api/medications/cm1abc", { id: "cm1abc" })).toBe(
      "/api/medications/[id]",
    );
  });

  it("handles several params and static segments between them", () => {
    expect(
      templatePath("/api/managed-profiles/p1/guardians/g7", {
        id: "p1",
        grantId: "g7",
      }),
    ).toBe("/api/managed-profiles/[id]/guardians/[grantId]");
  });

  it("collapses a catch-all run into one segment", () => {
    expect(
      templatePath("/api/monitoring/umami/api/send/x", {
        path: ["api", "send", "x"],
      }),
    ).toBe("/api/monitoring/umami/[...path]");
  });

  it("places a value equal to an earlier static segment on the dynamic one", () => {
    expect(templatePath("/api/labs/labs", { id: "labs" })).toBe(
      "/api/labs/[id]",
    );
  });

  it("matches an encoded segment against its decoded value", () => {
    expect(templatePath("/api/fhir/a%20b", { system: "a b" })).toBe(
      "/api/fhir/[system]",
    );
  });

  it("returns the pathname when a value is not in it", () => {
    expect(templatePath("/api/x/1", { id: "2" })).toBe("/api/x/1");
  });
});

describe("routeTemplateFor", () => {
  it("awaits Next's params promise", async () => {
    await expect(
      routeTemplateFor("/api/medications/m1", {
        params: Promise.resolve({ id: "m1" }),
      }),
    ).resolves.toBe("/api/medications/[id]");
  });

  it("leaves a static route as it is", async () => {
    await expect(routeTemplateFor("/api/version", undefined)).resolves.toBe(
      "/api/version",
    );
  });

  it("falls back to the pathname when params reject", async () => {
    await expect(
      routeTemplateFor("/api/x/1", { params: Promise.reject(new Error("x")) }),
    ).resolves.toBe("/api/x/1");
  });
});

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/hmac", () => ({ hashToken: vi.fn() }));
vi.mock("@/lib/auth/audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));

describe("apiHandler's wide event", () => {
  it("carries the template in http.route and the concrete path in http.path", async () => {
    const route = apiHandler(
      async (_req: unknown, _ctx: { params: Promise<{ id: string }> }) =>
        apiSuccess({ ok: true }),
    );
    await route(new NextRequest("http://localhost/api/medications/cm9"), {
      params: Promise.resolve({ id: "cm9" }),
    });

    const event = vi.mocked(emitIfSampled).mock.calls.at(-1)![0] as {
      http: { path: string; route: string };
    };
    expect(event.http.path).toBe("/api/medications/cm9");
    expect(event.http.route).toBe("/api/medications/[id]");
  });

  it("still scrubs a path secret from both fields", async () => {
    const route = apiHandler(async (_req: NextRequest) =>
      apiSuccess({ ok: true }),
    );
    // No params handed in: the route falls back to the pathname, and the
    // redaction floor still hides the secret.
    await route(
      new NextRequest("http://localhost/api/withings/webhook/s3cr3t-value"),
    );
    const event = vi.mocked(emitIfSampled).mock.calls.at(-1)![0] as {
      http: { path: string; route: string };
    };
    expect(event.http.path).not.toContain("s3cr3t-value");
    expect(event.http.route).not.toContain("s3cr3t-value");
  });
});
