/**
 * The proxy's side of a notification quick answer (#1203).
 *
 * ntfy's `http` action POSTs to `/api/notifications/action/<token>` with no
 * cookie, no Origin and an empty body. That request must pass the proxy
 * untouched. Every request the proxy refuses on this path must leave one log
 * line with a reason, because the route's own wide event never runs for it
 * and the server log is the operator's only evidence. The token must never be
 * in that line.
 */
import { NextRequest } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

const processType = vi.hoisted(() => ({ web: true }));
vi.mock("@/lib/process-type", () => ({
  shouldRunWeb: () => processType.web,
}));

import { proxy } from "../proxy";

const TOKEN =
  "na1.cuserid0000000000000000.mood-good.1792017927608.ACWxZHsEVXyh-Yghadj-2Q.PRmiFi7-C4ZkQ45E9YHl95GjSXoeV3xZMwLJ90Ts4QY";
const URL_ = `https://health.example.test/api/notifications/action/${TOKEN}`;

/** The request ntfy's Android app sends for an `http` action. */
function ntfyRequest(method = "POST"): NextRequest {
  return new NextRequest(URL_, {
    method,
    headers: { "user-agent": "ntfy/1.16.0 (okhttp)", "content-length": "0" },
    ...(method === "POST" ? { body: "" } : {}),
  });
}

let warn: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  processType.web = true;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
});

function loggedLines(): Array<Record<string, unknown>> {
  return warn.mock.calls.map((args: unknown[]) => JSON.parse(String(args[0])));
}

describe("proxy on /api/notifications/action/<token>", () => {
  it("passes ntfy's POST through to the route without a refusal", () => {
    const response = proxy(ntfyRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "PUT", "DELETE"])(
    "refuses %s with 405 and logs why, without the token",
    (method) => {
      const response = proxy(ntfyRequest(method));

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      const lines = loggedLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "warn",
        action: { name: "notification.action.refused" },
        meta: { reason: "method_not_allowed" },
        http: {
          method,
          status: 405,
          path: "/api/notifications/action/[REDACTED]",
        },
      });
      expect(String(warn.mock.calls[0][0])).not.toContain(TOKEN);
      expect(String(warn.mock.calls[0][0])).not.toContain("PRmiFi7");
    },
  );

  it("logs the demo-mode refusal", () => {
    vi.stubEnv("DEMO_MODE", "true");
    const response = proxy(ntfyRequest());

    expect(response.status).toBe(403);
    expect(loggedLines()[0]).toMatchObject({
      meta: { reason: "demo_mode" },
      http: { status: 403 },
    });
  });

  it("logs the worker-only refusal", () => {
    processType.web = false;
    const response = proxy(ntfyRequest());

    expect(response.status).toBe(503);
    expect(loggedLines()[0]).toMatchObject({
      meta: { reason: "worker_only" },
      http: { status: 503 },
    });
  });

  it("logs nothing for a refusal on any other path", () => {
    vi.stubEnv("DEMO_MODE", "true");
    proxy(
      new NextRequest("https://health.example.test/api/measurements", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
