import { describe, expect, it, beforeEach } from "vitest";
import {
  appendLogEvent,
  readLogBuffer,
  clearLogBuffer,
  getLogBufferSize,
  LOG_BUFFER_MAX,
  PROBLEMS_BUFFER_MAX,
} from "../in-memory-buffer";
import type { WideEvent } from "../types";

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

describe("in-memory log buffer", () => {
  beforeEach(() => {
    clearLogBuffer();
  });

  it("returns nothing when empty", () => {
    expect(readLogBuffer({})).toEqual([]);
  });

  it("stores appended events and returns them newest-first", () => {
    const a = makeEvent({ timestamp: "2026-05-09T20:00:00.000Z" });
    const b = makeEvent({ timestamp: "2026-05-09T20:01:00.000Z" });
    const c = makeEvent({ timestamp: "2026-05-09T20:02:00.000Z" });
    appendLogEvent(a);
    appendLogEvent(b);
    appendLogEvent(c);
    const out = readLogBuffer({});
    expect(out).toHaveLength(3);
    // Newest-first
    expect(out[0].timestamp).toBe(c.timestamp);
    expect(out[1].timestamp).toBe(b.timestamp);
    expect(out[2].timestamp).toBe(a.timestamp);
  });

  it("FIFO-evicts when capacity is exceeded (cap = LOG_BUFFER_MAX)", () => {
    expect(LOG_BUFFER_MAX).toBe(500);
    for (let i = 0; i < 510; i++) {
      appendLogEvent(makeEvent({ request_id: `req-${i}` }));
    }
    const out = readLogBuffer({});
    expect(out).toHaveLength(500);
    // oldest 10 events were dropped — req-0..req-9 must NOT be present
    const ids = new Set(out.map((e) => e.request_id));
    expect(ids.has("req-0")).toBe(false);
    expect(ids.has("req-9")).toBe(false);
    expect(ids.has("req-10")).toBe(true);
    expect(ids.has("req-509")).toBe(true);
  });

  it("filters by traceId", () => {
    appendLogEvent(makeEvent({ trace_id: "alpha" }));
    appendLogEvent(makeEvent({ trace_id: "beta" }));
    appendLogEvent(makeEvent({ trace_id: "alpha" }));
    const out = readLogBuffer({ traceId: "alpha" });
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.trace_id === "alpha")).toBe(true);
  });

  it("filters by level", () => {
    appendLogEvent(makeEvent({ level: "info" }));
    appendLogEvent(makeEvent({ level: "warn" }));
    appendLogEvent(makeEvent({ level: "error" }));
    expect(readLogBuffer({ level: "warn" })).toHaveLength(1);
    expect(readLogBuffer({ level: "error" })).toHaveLength(1);
  });

  it("filters by action substring (case-insensitive)", () => {
    appendLogEvent(makeEvent({ action: { name: "measurement.create" } }));
    appendLogEvent(makeEvent({ action: { name: "auth.login" } }));
    appendLogEvent(makeEvent({ action: { name: "measurement.delete" } }));
    const out = readLogBuffer({ action: "measurement" });
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.action?.name?.startsWith("measurement"))).toBe(
      true,
    );
    // Case-insensitive
    expect(readLogBuffer({ action: "AUTH" })).toHaveLength(1);
  });

  it("filters by since/until window", () => {
    appendLogEvent(makeEvent({ timestamp: "2026-05-09T10:00:00.000Z" }));
    appendLogEvent(makeEvent({ timestamp: "2026-05-09T12:00:00.000Z" }));
    appendLogEvent(makeEvent({ timestamp: "2026-05-09T14:00:00.000Z" }));
    const out = readLogBuffer({
      since: new Date("2026-05-09T11:00:00.000Z"),
      until: new Date("2026-05-09T13:00:00.000Z"),
    });
    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBe("2026-05-09T12:00:00.000Z");
  });

  it("respects the limit option", () => {
    for (let i = 0; i < 50; i++) {
      appendLogEvent(makeEvent({ request_id: `r-${i}` }));
    }
    expect(readLogBuffer({ limit: 5 })).toHaveLength(5);
  });

  it("clears the buffer", () => {
    appendLogEvent(makeEvent());
    appendLogEvent(makeEvent());
    expect(readLogBuffer({})).toHaveLength(2);
    clearLogBuffer();
    expect(readLogBuffer({})).toHaveLength(0);
  });

  it("keeps warn and error in the problems ring while info traffic turns the main ring over", () => {
    expect(PROBLEMS_BUFFER_MAX).toBe(1000);
    appendLogEvent(
      makeEvent({ level: "error", request_id: "3f9a2c1b-dead-beef" }),
    );
    appendLogEvent(makeEvent({ level: "warn", request_id: "warn-0001" }));
    for (let i = 0; i < LOG_BUFFER_MAX + 50; i++) {
      appendLogEvent(makeEvent({ level: "info" }));
    }
    // The main ring lost both; the problems ring kept them.
    expect(readLogBuffer({ requestId: "3f9a2c1b" })).toHaveLength(0);
    const found = readLogBuffer({ ring: "problems", requestId: "3f9a2c1b" });
    expect(found.map((e) => e.request_id)).toEqual(["3f9a2c1b-dead-beef"]);
    expect(getLogBufferSize("problems")).toBe(2);
  });

  it("FIFO-evicts the problems ring at its own cap and never admits info or debug", () => {
    appendLogEvent(makeEvent({ level: "debug" }));
    for (let i = 0; i < PROBLEMS_BUFFER_MAX + 5; i++) {
      appendLogEvent(makeEvent({ level: "error", request_id: `e-${i}` }));
    }
    const out = readLogBuffer({ ring: "problems" });
    expect(out).toHaveLength(PROBLEMS_BUFFER_MAX);
    expect(out[0].request_id).toBe(`e-${PROBLEMS_BUFFER_MAX + 4}`);
    expect(out.every((e) => e.level === "error")).toBe(true);
  });

  it("matches a request id by case-insensitive prefix", () => {
    appendLogEvent(makeEvent({ request_id: "ABCDEF12-0000" }));
    appendLogEvent(makeEvent({ request_id: "abcdef99-0000" }));
    expect(readLogBuffer({ requestId: "abcdef12" })).toHaveLength(1);
    expect(readLogBuffer({ requestId: "abcdef" })).toHaveLength(2);
    expect(readLogBuffer({ requestId: "ABCDEF12-0000" })).toHaveLength(1);
  });
});
