import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-handler", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-handler")>(
      "@/lib/api-handler",
    );
  return {
    ...actual,
    apiHandler: <T extends (...args: unknown[]) => Promise<Response>>(
      h: T,
    ): T => h,
    requireAdmin: vi.fn(),
  };
});

vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
  getEvent: vi.fn(() => null),
}));

import { GET } from "../route";
import { requireAdmin } from "@/lib/api-handler";
import { appendLogEvent, clearLogBuffer } from "@/lib/logging/in-memory-buffer";
import type { WideEvent } from "@/lib/logging/types";

const ADMIN_CTX = {
  authMethod: "cookie" as const,
  session: { id: "s1", expiresAt: new Date(Date.now() + 3_600_000) },
  user: { id: "admin-1", username: "admin", role: "ADMIN" } as never,
};

function makeEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    timestamp: new Date().toISOString(),
    duration_ms: 12,
    request_id: "req-" + Math.random().toString(16).slice(2),
    trace_id: "trace-" + Math.random().toString(16).slice(2),
    level: "info",
    kind: "http",
    service: "healthlog",
    environment: "test",
    ...overrides,
  };
}

function req(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/app-logs${query ? "?" + query : ""}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN_CTX);
  clearLogBuffer();
});

describe("GET /api/admin/app-logs", () => {
  it("returns the buffered events newest-first", async () => {
    appendLogEvent(makeEvent({ trace_id: "first" }));
    appendLogEvent(makeEvent({ trace_id: "second" }));
    const res = await GET(req());
    const json = (await res.json()) as {
      data: { events: WideEvent[]; meta: { total: number } };
    };
    expect(json.data.events).toHaveLength(2);
    expect(json.data.events[0].trace_id).toBe("second");
    expect(json.data.meta.total).toBe(2);
  });

  it("filters by traceId", async () => {
    appendLogEvent(makeEvent({ trace_id: "alpha" }));
    appendLogEvent(makeEvent({ trace_id: "beta" }));
    const res = await GET(req("traceId=alpha"));
    const json = (await res.json()) as { data: { events: WideEvent[] } };
    expect(json.data.events).toHaveLength(1);
    expect(json.data.events[0].trace_id).toBe("alpha");
  });

  it("filters by level + action substring", async () => {
    appendLogEvent(
      makeEvent({ level: "info", action: { name: "measurement.create" } }),
    );
    appendLogEvent(
      makeEvent({ level: "error", action: { name: "auth.login.failed" } }),
    );
    const res = await GET(req("level=error&action=auth"));
    const json = (await res.json()) as { data: { events: WideEvent[] } };
    expect(json.data.events).toHaveLength(1);
    expect(json.data.events[0].action?.name).toBe("auth.login.failed");
  });

  it("redacts secrets in error.message before egress", async () => {
    appendLogEvent(
      makeEvent({
        level: "error",
        error: {
          type: "Error",
          // Bearer token in the error path — must be redacted on render.
          message: "Authorization: Bearer hlk_abc123def456 invalid",
        },
      }),
    );
    const res = await GET(req());
    const json = (await res.json()) as { data: { events: WideEvent[] } };
    expect(json.data.events[0].error?.message).not.toContain(
      "hlk_abc123def456",
    );
    expect(json.data.events[0].error?.message).toContain("[REDACTED]");
  });

  it("supports the `limit` cap", async () => {
    for (let i = 0; i < 60; i++) {
      appendLogEvent(makeEvent({ request_id: `r-${i}` }));
    }
    const res = await GET(req("limit=10"));
    const json = (await res.json()) as { data: { events: WideEvent[] } };
    expect(json.data.events).toHaveLength(10);
  });

  it("rejects an invalid level value with a 422 (not a thrown 500)", async () => {
    appendLogEvent(makeEvent());
    // Invalid `level` — the query is parsed with `safeParse` and returns the
    // standard 422 multi-issue envelope rather than throwing (which the
    // apiHandler catch ladder would otherwise surface as a 500 + incident).
    const res = await GET(req("level=critical"));
    expect(res.status).toBe(422);
    const json = (await res.json()) as {
      data: null;
      error: string;
      details: { issues: unknown[] };
    };
    expect(json.data).toBeNull();
    expect(json.error).toBe("Validation failed");
    expect(json.details.issues.length).toBeGreaterThan(0);
  });

  it("finds an error by the first 8 characters of its id in the problems ring", async () => {
    appendLogEvent(
      makeEvent({ level: "error", request_id: "3f9a2c1b-1111-4000-8000-0000" }),
    );
    for (let i = 0; i < 600; i++) {
      appendLogEvent(makeEvent({ level: "info" }));
    }
    const gone = await GET(req("requestId=3f9a2c1b"));
    const goneJson = (await gone.json()) as { data: { events: WideEvent[] } };
    expect(goneJson.data.events).toHaveLength(0);

    const res = await GET(req("requestId=3f9a2c1b&ring=problems"));
    const json = (await res.json()) as {
      data: {
        events: WideEvent[];
        meta: { problemsBufferMax: number; ring: string };
      };
    };
    expect(json.data.events.map((e) => e.request_id)).toEqual([
      "3f9a2c1b-1111-4000-8000-0000",
    ]);
    expect(json.data.meta.problemsBufferMax).toBe(1000);
    expect(json.data.meta.ring).toBe("problems");
  });

  it("refuses a request id shorter than 8 characters or outside the id alphabet", async () => {
    for (const bad of ["3f9a2c1", "3f9a2c1b%20OR%201", "a".repeat(65)]) {
      const res = await GET(req(`requestId=${bad}`));
      expect(res.status).toBe(422);
    }
    const ring = await GET(req("ring=everything"));
    expect(ring.status).toBe(422);
  });
});
