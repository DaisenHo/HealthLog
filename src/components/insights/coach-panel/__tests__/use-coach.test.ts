import { describe, it, expect } from "vitest";

import { parseSseChunk } from "../use-coach";
import type { CoachStreamEvent } from "@/lib/ai/coach/types";

/**
 * v1.4.20 — SSE parser unit tests.
 *
 * The streaming hook is a thin wrapper around `parseSseChunk` plus a
 * `fetch` reader. We test the parser exhaustively here and rely on
 * vitest's node environment to validate that browser primitives like
 * `ReadableStream` and `TextDecoder` are wired correctly.
 */

function frame(event: CoachStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("parseSseChunk", () => {
  it("parses a single token frame in one chunk", () => {
    const { events, rest } = parseSseChunk(
      "",
      frame({ type: "token", token: "Hello" }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "token", token: "Hello" });
    expect(rest).toBe("");
  });

  it("accumulates tokens across two frames in one chunk", () => {
    const chunk =
      frame({ type: "token", token: "Hello " }) +
      frame({ type: "token", token: "world" });
    const { events, rest } = parseSseChunk("", chunk);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "token", token: "Hello " });
    expect(events[1]).toEqual({ type: "token", token: "world" });
    expect(rest).toBe("");
  });

  it("carries an incomplete frame across calls in `rest`", () => {
    const full = frame({ type: "token", token: "abcdef" });
    const half = full.slice(0, 12); // partial — no \n\n
    const remainder = full.slice(12);
    const first = parseSseChunk("", half);
    expect(first.events).toHaveLength(0);
    expect(first.rest).toBe(half);
    const second = parseSseChunk(first.rest, remainder);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toEqual({ type: "token", token: "abcdef" });
    expect(second.rest).toBe("");
  });

  it("parses provenance frames with the metricSource shape", () => {
    const provenance = frame({
      type: "provenance",
      metricSource: {
        windows: ["last30days"],
        metrics: ["bp", "pulse"],
        counts: { bp: 12 },
      },
    });
    const { events } = parseSseChunk("", provenance);
    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt.type).toBe("provenance");
    if (evt.type === "provenance") {
      expect(evt.metricSource.windows).toEqual(["last30days"]);
      expect(evt.metricSource.metrics).toEqual(["bp", "pulse"]);
      expect(evt.metricSource.counts).toEqual({ bp: 12 });
    }
  });

  it("parses a done frame with conversationId + messageId", () => {
    const { events } = parseSseChunk(
      "",
      frame({
        type: "done",
        conversationId: "conv-abc",
        messageId: "msg-xyz",
      }),
    );
    expect(events).toEqual([
      { type: "done", conversationId: "conv-abc", messageId: "msg-xyz" },
    ]);
  });

  it("parses an error frame", () => {
    const { events } = parseSseChunk(
      "",
      frame({
        type: "error",
        code: "coach.provider.unavailable",
        message: "coach.provider.unavailable",
      }),
    );
    expect(events).toEqual([
      {
        type: "error",
        code: "coach.provider.unavailable",
        message: "coach.provider.unavailable",
      },
    ]);
  });

  it("ignores malformed frames silently", () => {
    const chunk = "data: not-json\n\n" + frame({ type: "token", token: "ok" });
    const { events } = parseSseChunk("", chunk);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "token", token: "ok" });
  });

  it("ignores frames without a data: line", () => {
    const chunk = "event: heartbeat\n\n" + frame({ type: "token", token: "x" });
    const { events } = parseSseChunk("", chunk);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "token", token: "x" });
  });

  it("handles a stream split byte-by-byte (worst-case interleaving)", () => {
    const full =
      frame({ type: "token", token: "Hi " }) +
      frame({ type: "token", token: "there" }) +
      frame({ type: "done", conversationId: "c", messageId: "m" });
    let buffer = "";
    const events: CoachStreamEvent[] = [];
    for (const ch of full) {
      const out = parseSseChunk(buffer, ch);
      events.push(...out.events);
      buffer = out.rest;
    }
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "token", token: "Hi " });
    expect(events[1]).toEqual({ type: "token", token: "there" });
    expect(events[2]).toEqual({
      type: "done",
      conversationId: "c",
      messageId: "m",
    });
  });

  it("returns no events for an empty input", () => {
    const { events, rest } = parseSseChunk("", "");
    expect(events).toEqual([]);
    expect(rest).toBe("");
  });

  it("simulates the full round-trip a streaming hook would observe", () => {
    // Reproduce what the hook does internally: feed three chunks (with
    // a split frame across chunks 2 and 3), verify the assistant's
    // content + provenance are accumulated correctly.
    const tokens = [
      frame({ type: "token", token: "Looking " }),
      frame({ type: "token", token: "at " }),
      frame({ type: "token", token: "your " }),
      frame({ type: "token", token: "BP, " }),
    ].join("");
    const provenance = frame({
      type: "provenance",
      metricSource: { windows: ["last7days"], metrics: ["bp"] },
    });
    const done = frame({
      type: "done",
      conversationId: "conv-1",
      messageId: "msg-1",
    });
    const all = tokens + provenance + done;

    // Split deliberately mid-frame.
    const chunks = [
      all.slice(0, 30),
      all.slice(30, 80),
      all.slice(80, 140),
      all.slice(140),
    ];

    let buffer = "";
    const events: CoachStreamEvent[] = [];
    for (const c of chunks) {
      const out = parseSseChunk(buffer, c);
      events.push(...out.events);
      buffer = out.rest;
    }

    const tokenText = events
      .filter(
        (e): e is Extract<CoachStreamEvent, { type: "token" }> =>
          e.type === "token",
      )
      .map((e) => e.token)
      .join("");
    expect(tokenText).toBe("Looking at your BP, ");
    const provEvent = events.find((e) => e.type === "provenance");
    expect(provEvent).toBeDefined();
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
  });
});
