import { beforeEach, describe, expect, it, vi } from "vitest";

const safeFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-fetch")>()),
  safeFetch: safeFetchMock,
}));

import { DawarichApiError, probeDawarich } from "../client";

const CONN = { baseUrl: "https://dawarich.example.com", apiKey: "key" };

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("reading a Dawarich answer", () => {
  it("parses an honest answer", async () => {
    safeFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 }),
    );
    await expect(probeDawarich(CONN)).resolves.toBeUndefined();
  });

  it("stops reading an answer that runs past the cap", async () => {
    // Streamed without a length, so only the running count can catch it.
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 64) controller.close();
        else controller.enqueue(chunk);
      },
    });
    safeFetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    const failure = await probeDawarich(CONN).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DawarichApiError);
    expect((failure as Error).message).toMatch(/oversized/);
    expect(sent).toBeLessThan(64);
  });
});
