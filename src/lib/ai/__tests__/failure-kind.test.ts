/**
 * #1267 — `providerFailureKind` against the errors the real request path
 * throws: the local client, `safeFetch`, the pinned operator-approved
 * dispatcher and a loopback server that misbehaves on purpose. Every case
 * used to log as `cause: "network"`.
 */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalOpenAICompatibleClient } from "../local-client";
import { providerFailureKind } from "../failure-kind";
import { resetReasoningDialectCache } from "../reasoning/dialect-cache";
import { singleUserTurn } from "../types";
import { _resetPinnedDispatcherForTests } from "@/lib/safe-fetch-dispatcher";

type Behaviour =
  | "slow"
  | "drop-mid-body"
  | "not-json"
  | "http-500"
  | "empty"
  | "reasoning-only";

let behaviour: Behaviour = "slow";
let server: http.Server;
let origin: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      switch (behaviour) {
        case "slow":
          setTimeout(() => res.end("{}"), 1_000);
          return;
        case "drop-mid-body":
          res.writeHead(200, { "Content-Type": "application/json" });
          res.write('{"choices":[{"message":{"content":"half');
          setTimeout(() => res.socket?.destroy(), 20);
          return;
        case "not-json":
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("<html>proxy error</html>");
          return;
        case "http-500":
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end('{"error":"boom"}');
          return;
        case "empty":
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: "" }, finish_reason: "stop" }],
            }),
          );
          return;
        case "reasoning-only":
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: { content: "", reasoning: "thinking…" },
                  finish_reason: "length",
                },
              ],
            }),
          );
          return;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  _resetPinnedDispatcherForTests();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  resetReasoningDialectCache();
});

async function failureFor(
  target: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; effort?: "none" } = {},
) {
  const saved = process.env.AI_PRIVATE_ORIGINS;
  process.env.AI_PRIVATE_ORIGINS = new URL(target).origin;
  try {
    const c = new LocalOpenAICompatibleClient({
      baseUrl: `${target}/v1`,
      model: "m",
    });
    if (opts.effort) c.reasoningEffort = opts.effort;
    const err = await c
      .generateCompletion({
        ...singleUserTurn({
          system: "s",
          user: "u",
          timeoutMs: opts.timeoutMs ?? 5_000,
        }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).not.toBeNull();
    return providerFailureKind(err);
  } finally {
    if (saved === undefined) delete process.env.AI_PRIVATE_ORIGINS;
    else process.env.AI_PRIVATE_ORIGINS = saved;
  }
}

async function closedPortOrigin(): Promise<string> {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

describe("providerFailureKind on the real request path", () => {
  it("names our own deadline a timeout", async () => {
    behaviour = "slow";
    expect(await failureFor(origin, { timeoutMs: 150 })).toEqual({
      failure: "timeout",
      code: null,
    });
  });

  it("names a caller cancel an abort, not a timeout", async () => {
    behaviour = "slow";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    expect(
      (await failureFor(origin, { signal: controller.signal })).failure,
    ).toBe("aborted");
  });

  it("names a refused connection with its code", async () => {
    expect(await failureFor(await closedPortOrigin())).toEqual({
      failure: "refused",
      code: "ECONNREFUSED",
    });
  });

  it("names a connection dropped mid-body a socket failure", async () => {
    behaviour = "drop-mid-body";
    const out = await failureFor(origin);
    expect(out.failure).toBe("socket");
    expect(out.code).toMatch(/^UND_ERR_/);
  });

  it("names a 200 that is not JSON a parse failure", async () => {
    behaviour = "not-json";
    expect((await failureFor(origin)).failure).toBe("parse");
  });

  it("names a non-2xx status http", async () => {
    behaviour = "http-500";
    expect((await failureFor(origin)).failure).toBe("http");
  });

  it("tells an empty answer from one that only reasoned", async () => {
    behaviour = "empty";
    expect((await failureFor(origin)).failure).toBe("empty_response");
    // Already asked with `none`: nothing left to retry, the reply is final.
    behaviour = "reasoning-only";
    expect((await failureFor(origin, { effort: "none" })).failure).toBe(
      "reasoning_only",
    );
  });

  it("never lets a free-form string through as a code", () => {
    const err = Object.assign(new Error("x"), {
      code: "see http://user:pass@host/",
    });
    expect(providerFailureKind(err)).toEqual({
      failure: "unknown",
      code: null,
    });
  });
});
