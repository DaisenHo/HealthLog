import { describe, it, expect } from "vitest";
import { createSseStream } from "../create-stream";

/**
 * v1.4.22 — extracted SSE-stream constructor.
 *
 * Pin the contract: emit can be sync or async, the controller is
 * always closed (success or thrown), and the resulting stream reads
 * as a real `ReadableStream<Uint8Array>`.
 */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("createSseStream", () => {
  it("enqueues frames from a synchronous emit callback and closes", async () => {
    const stream = createSseStream((controller) => {
      controller.enqueue(new TextEncoder().encode("data: one\n\n"));
      controller.enqueue(new TextEncoder().encode("data: two\n\n"));
    });
    expect(await readAll(stream)).toBe("data: one\n\ndata: two\n\n");
  });

  it("awaits an async emit callback before closing", async () => {
    const stream = createSseStream(async (controller) => {
      await Promise.resolve();
      controller.enqueue(new TextEncoder().encode("data: async\n\n"));
    });
    expect(await readAll(stream)).toBe("data: async\n\n");
  });

  it("closes the stream cleanly even when emit throws", async () => {
    const stream = createSseStream(() => {
      throw new Error("emit-failure");
    });
    // Should not hang — the finally block always closes the
    // controller. The reader sees an empty body.
    expect(await readAll(stream)).toBe("");
  });
});
