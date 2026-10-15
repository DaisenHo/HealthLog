/**
 * Per-process in-memory ring buffer for the most recent wide events.
 *
 * Used by `/admin/app-logs` so admins can drill into structured wide-events
 * without standing up a Loki stack just to read the last hour of traffic.
 * Events are pushed by `transports.emitEvent()` after they pass the sampler
 * gate (so the buffer mirrors what a Loki sink would receive, not the raw
 * pre-sampling firehose).
 *
 * Limitations:
 *   - Per-process. Under `HEALTHLOG_PROCESS_TYPE=web,worker` split, the
 *     web buffer doesn't see worker events and vice-versa. The UI surfaces
 *     this caveat in the section header.
 *   - 500-entry cap (~500KB max @ ~1KB/event). FIFO eviction on overflow.
 *   - A second ring, `problems`, keeps the last 1,000 `warn` and `error`
 *     events only. On a busy host the 500 entries of the main ring turn over
 *     in minutes of ordinary traffic, so the one failure a person reports
 *     was gone by the time the operator looked for it. Info traffic never
 *     enters the problems ring and cannot evict from it.
 *   - Volatile — restart drops the buffer. For durable storage configure
 *     `LOKI_ENDPOINT` and tail Loki instead.
 *
 * Privacy: events stored raw. The API render path (`/api/admin/app-logs`)
 * runs `redactSecrets()` on egress so a stray Bearer token in an error
 * message never leaks to the admin UI.
 */
import type { WideEvent, LogLevel } from "./types";

export const LOG_BUFFER_MAX = 500;

/** Capacity of the warn/error-only ring. */
export const PROBLEMS_BUFFER_MAX = 1000;

/** Which ring a read walks: every event, or only `warn` and `error`. */
export type LogRing = "all" | "problems";

// Plain arrays with FIFO eviction. A linked list would be technically tighter
// but for 1,000 entries the array shift overhead (~microseconds) is invisible
// next to the rest of the request lifecycle.
let buffer: WideEvent[] = [];
let problems: WideEvent[] = [];

/** Whether an event belongs in the problems ring. */
function isProblem(event: WideEvent): boolean {
  return event.level === "warn" || event.level === "error";
}

/**
 * Append an event to the main ring and, for `warn` and `error`, to the
 * problems ring; each evicts its oldest entry once its cap is hit. The same
 * object sits in both, so an event costs its memory once.
 */
export function appendLogEvent(event: WideEvent): void {
  buffer.push(event);
  if (buffer.length > LOG_BUFFER_MAX) {
    buffer.shift();
  }
  if (isProblem(event)) {
    problems.push(event);
    if (problems.length > PROBLEMS_BUFFER_MAX) {
      problems.shift();
    }
  }
}

export interface ReadLogBufferOptions {
  /** The ring to read; `all` when absent. */
  ring?: LogRing;
  /**
   * Prefix match on `event.request_id`, case-insensitive. A person reads out
   * the first 8 characters of an error id; the full id matches too.
   */
  requestId?: string;
  /** Exact match on `event.trace_id`. */
  traceId?: string;
  /** Exact match on `event.level`. */
  level?: LogLevel;
  /** Case-insensitive substring match on `event.action.name`. */
  action?: string;
  /** Inclusive lower bound on `event.timestamp`. */
  since?: Date;
  /** Inclusive upper bound on `event.timestamp`. */
  until?: Date;
  /** Cap the number of returned entries. */
  limit?: number;
}

/**
 * Read the buffer with optional filters. Results are returned newest-first
 * (descending by insertion order, which matches `event.timestamp` since we
 * push at request-finish time).
 */
export function readLogBuffer(opts: ReadLogBufferOptions): WideEvent[] {
  const sinceMs = opts.since?.getTime();
  const untilMs = opts.until?.getTime();
  const actionLower = opts.action?.toLowerCase();
  const requestIdLower = opts.requestId?.toLowerCase();
  const source = opts.ring === "problems" ? problems : buffer;

  // Walk back-to-front so the result is newest-first without an extra reverse.
  const out: WideEvent[] = [];
  for (let i = source.length - 1; i >= 0; i--) {
    const event = source[i];
    if (
      requestIdLower &&
      !(event.request_id ?? "").toLowerCase().startsWith(requestIdLower)
    ) {
      continue;
    }
    if (opts.traceId && event.trace_id !== opts.traceId) continue;
    if (opts.level && event.level !== opts.level) continue;
    if (actionLower) {
      const name = event.action?.name?.toLowerCase() ?? "";
      if (!name.includes(actionLower)) continue;
    }
    if (sinceMs !== undefined || untilMs !== undefined) {
      const ts = Date.parse(event.timestamp);
      if (sinceMs !== undefined && ts < sinceMs) continue;
      if (untilMs !== undefined && ts > untilMs) continue;
    }
    out.push(event);
    if (opts.limit !== undefined && out.length >= opts.limit) break;
  }
  return out;
}

/** Reset the buffer (test-only — not exported from the package index). */
export function clearLogBuffer(): void {
  buffer = [];
  problems = [];
}

/** Current buffer size (test-only). */
export function getLogBufferSize(ring: LogRing = "all"): number {
  return ring === "problems" ? problems.length : buffer.length;
}
