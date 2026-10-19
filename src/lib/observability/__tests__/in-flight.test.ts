import { EventEmitter } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import {
  InFlightRegistry,
  routeLabel,
  startHttpInFlightTracking,
  inFlightRegistry,
  trackHttpRequest,
  trackInFlight,
} from "../in-flight";

/**
 * The register is only worth anything if it is accurate at the moment the
 * heap runs out: an entry that outlives its work is a leak that grows with
 * every request, and a register that grows without bound is itself the
 * memory problem it is meant to name.
 */

function fakeExchange(url: string, headers: Record<string, string> = {}) {
  const response = new EventEmitter();
  return {
    message: {
      request: { url, method: "POST", headers },
      response,
    } as unknown as Parameters<typeof trackHttpRequest>[0],
    close: () => response.emit("close"),
  };
}

describe("InFlightRegistry", () => {
  it("removes the entry when the work resolves", async () => {
    const registry = new InFlightRegistry();
    await trackInFlight(
      { kind: "job", target: "q" },
      async () => {
        expect(registry.size).toBe(1);
      },
      registry,
    );
    expect(registry.size).toBe(0);
  });

  it("removes the entry when the work throws", async () => {
    const registry = new InFlightRegistry();
    await expect(
      trackInFlight(
        { kind: "job", target: "q" },
        async () => {
          throw new Error("boom");
        },
        registry,
      ),
    ).rejects.toThrow("boom");
    expect(registry.size).toBe(0);
  });

  it("refuses entries past its bound and counts them", () => {
    const registry = new InFlightRegistry(3);
    const ids = [1, 2, 3, 4, 5].map(() =>
      registry.begin({ kind: "http", target: "/", startedAt: 0 }),
    );
    expect(registry.size).toBe(3);
    expect(registry.dropped).toBe(2);
    expect(ids.slice(3)).toEqual([0, 0]);
    // A refused id ends as a no-op and never removes someone else's entry.
    registry.end(0);
    expect(registry.size).toBe(3);
    registry.end(ids[0]);
    expect(registry.size).toBe(2);
  });

  it("reports the oldest entries and the routes most of them share", () => {
    const registry = new InFlightRegistry();
    registry.begin({ kind: "job", target: "backup", startedAt: 1_000 });
    for (let i = 0; i < 3; i++) {
      registry.begin({
        kind: "http",
        method: "POST",
        target: "/login",
        serverAction: true,
        startedAt: 50_000 + i,
      });
    }
    const report = registry.report(61_000, 2);
    expect(report.oldest).toEqual([
      { kind: "job", route: "backup", age_s: 60 },
      {
        kind: "http",
        method: "POST",
        route: "/login",
        server_action: true,
        age_s: 11,
      },
    ]);
    expect(report.by_route[0]).toEqual({
      kind: "http",
      route: "/login",
      count: 3,
    });
  });
});

describe("HTTP request tracking", () => {
  it("keeps the request until its response closes, without the query", () => {
    const registry = new InFlightRegistry();
    const exchange = fakeExchange("/api/x?token=abc", { "next-action": "1" });
    trackHttpRequest(exchange.message, registry);
    expect(registry.size).toBe(1);
    const [entry] = registry.report(Date.now(), 1).oldest;
    expect(entry.route).toBe("/api/x");
    expect(entry.server_action).toBe(true);
    expect(JSON.stringify(registry.report(Date.now(), 5))).not.toContain("abc");
    exchange.close();
    expect(registry.size).toBe(0);
  });

  it("removes an aborted request: close fires once, a second close is harmless", () => {
    const registry = new InFlightRegistry();
    const first = fakeExchange("/a");
    const second = fakeExchange("/b");
    trackHttpRequest(first.message, registry);
    trackHttpRequest(second.message, registry);
    first.close();
    first.close();
    expect(registry.size).toBe(1);
    second.close();
    expect(registry.size).toBe(0);
  });

  it("sees a real request through Node's server channel, and lets it go", async () => {
    startHttpInFlightTracking();
    const registry = inFlightRegistry();
    const before = registry.size;
    let during = -1;
    const server = createServer((_req, res) => {
      during = registry.size;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      httpRequest({ port, path: "/probe?x=1" }, (res) => {
        res.resume();
        res.on("end", resolve);
      })
        .on("error", reject)
        .end();
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(during).toBe(before + 1);
    expect(registry.size).toBe(before);
  });
});

describe("HTTP request tracking, client gone", () => {
  it("removes a request whose client hung up before any answer", async () => {
    startHttpInFlightTracking();
    const registry = inFlightRegistry();
    const before = registry.size;
    let serverSawClose: () => void = () => {};
    const closed = new Promise<void>((resolve) => (serverSawClose = resolve));
    let during = -1;
    const server = createServer((_req, res) => {
      during = registry.size;
      // Never answers; the client aborts.
      res.on("close", () => setImmediate(serverSawClose));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const req = httpRequest({ port, path: "/hang" });
    req.on("error", () => {});
    req.end();
    while (during === -1) await new Promise((r) => setTimeout(r, 5));
    req.destroy();
    await closed;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(during).toBe(before + 1);
    expect(registry.size).toBe(before);
  });
});

describe("routeLabel", () => {
  it("scrubs secret segments and collapses ids and payloads", () => {
    expect(
      routeLabel({ kind: "http", target: "/api/withings/webhook/s3cret" }),
    ).toBe("/api/withings/webhook/[REDACTED]");
    expect(
      routeLabel({
        kind: "http",
        target: "/api/measurements/clx9k2abcdefghij12345",
      }),
    ).toBe("/api/measurements/:id");
    expect(routeLabel({ kind: "http", target: "/api/items/42" })).toBe(
      "/api/items/:id",
    );
    expect(
      routeLabel({ kind: "http", target: "/%27%20OR%201=1--/login" }),
    ).toBe("/:x/login");
  });

  it("is bounded in segments and length", () => {
    const label = routeLabel({
      kind: "http",
      target: "/" + Array.from({ length: 30 }, () => "abc").join("/"),
    });
    expect(label.split("/").length).toBeLessThanOrEqual(10);
    expect(label.endsWith("/…")).toBe(true);
    expect(
      routeLabel({ kind: "http", target: "/" + "a/".repeat(500) }).length,
    ).toBeLessThanOrEqual(120);
  });
});
