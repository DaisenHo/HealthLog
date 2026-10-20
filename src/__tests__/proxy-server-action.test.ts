/**
 * A Server Action call is refused at the proxy.
 *
 * HealthLog defines no Server Actions, so the only requests that carry
 * `Next-Action` are scanners probing for them. Next used to answer each with
 * an unstructured "Failed to find Server Action" at error level; the proxy now
 * refuses it with a 404 and one structured `warn` line, and a request without
 * the header is untouched.
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

vi.mock("@/lib/process-type", () => ({ shouldRunWeb: () => true }));

import { proxy } from "../proxy";

let warn: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

function probe(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://health.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain", ...headers },
    body: "[]",
  });
}

describe("proxy on a Server Action call", () => {
  it("refuses it with 404 and one warn line", async () => {
    const response = proxy(
      probe("/", { "next-action": "7f3a9c", "user-agent": "scanner" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      data: null,
      error: "Not found",
      meta: { errorCode: "server_action.unsupported" },
    });
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({
      level: "warn",
      action: { name: "proxy.server_action.refused" },
      http: { method: "POST", path: "/", status: 404, user_agent: "scanner" },
    });
  });

  it("never logs a secret path segment the probe aimed at", () => {
    proxy(probe("/api/withings/webhook/s3cr3t-value", { "next-action": "x" }));

    const line = String(warn.mock.calls[0]![0]);
    expect(line).not.toContain("s3cr3t-value");
  });

  it("leaves a request without the header alone", () => {
    const response = proxy(probe("/api/health"));

    expect(response.status).not.toBe(404);
    expect(warn).not.toHaveBeenCalled();
  });
});
