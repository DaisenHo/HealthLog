import { subscribe } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";

import { redactSecrets } from "@/lib/logging/redact";

/**
 * What the process is doing right now: every HTTP request it has accepted and
 * not yet answered, and every queue job a handler is running.
 *
 * It exists for one moment, the heap-pressure report in `heap-monitor.ts`. A
 * process that runs out of heap dies without a JavaScript stack and without a
 * word about the work it was carrying, so the list has to be in memory and
 * ready before the heap is gone, not reconstructed afterwards.
 *
 * ## Why the HTTP side hooks the server and not `apiHandler` or the proxy
 *
 * `apiHandler` sees API routes only. Pages, RSC payloads and server actions,
 * which is what an unauthenticated scanner mostly hits, never pass through it.
 * The proxy sees those, but only on the way in: it hands the request on and
 * never learns when the render finished, so it cannot keep a live set. Node's
 * own `http.server.request.start` diagnostics channel fires for every request
 * the server accepts, in this process, before any Next.js code runs, and the
 * response's `close` event fires exactly once whether it finished or the
 * client went away. One map insert and one delete per request, nothing on the
 * request path itself.
 *
 * ## Bounds and privacy
 *
 * At most `IN_FLIGHT_MAX` entries; a request arriving past it is counted in
 * `dropped` and not kept. An entry holds strings and a number only, never the
 * request object, so a response whose `close` never fired cannot pin a body.
 * The query string is cut on entry and never stored. The path is kept as
 * received and turned into a label only when a report is written: secret path
 * segments scrubbed by `redactSecrets`, id-shaped and odd segments collapsed.
 */

export const IN_FLIGHT_MAX = 2000;

export type InFlightKind = "http" | "job";

export interface InFlightEntry {
  kind: InFlightKind;
  /** HTTP method; absent for jobs. */
  method?: string;
  /** Path without query for HTTP, queue name for jobs. */
  target: string;
  /** Set when the request carried a `Next-Action` header. */
  serverAction?: boolean;
  startedAt: number;
}

export interface InFlightReportEntry {
  kind: InFlightKind;
  method?: string;
  route: string;
  server_action?: true;
  age_s: number;
}

export class InFlightRegistry {
  private readonly entries = new Map<number, InFlightEntry>();
  private nextId = 1;
  private droppedCount = 0;

  constructor(private readonly max: number = IN_FLIGHT_MAX) {}

  /** Record a unit of work. Returns its id, or 0 when the register is full. */
  begin(entry: InFlightEntry): number {
    if (this.entries.size >= this.max) {
      this.droppedCount++;
      return 0;
    }
    const id = this.nextId++;
    this.entries.set(id, entry);
    return id;
  }

  /** Forget a unit of work. Idempotent; 0 is a no-op. */
  end(id: number): void {
    if (id !== 0) this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Requests and jobs refused because the register was full. */
  get dropped(): number {
    return this.droppedCount;
  }

  counts(): Record<InFlightKind, number> {
    const out: Record<InFlightKind, number> = { http: 0, job: 0 };
    for (const entry of this.entries.values()) out[entry.kind]++;
    return out;
  }

  /**
   * The report a pressure event carries: the `limit` oldest entries, and the
   * `limit` most frequent labels with how many entries share each. A flood of
   * young requests to one route shows in the second list even when the first
   * is all slow jobs.
   */
  report(
    now: number,
    limit: number,
  ): {
    oldest: InFlightReportEntry[];
    by_route: Array<{ kind: InFlightKind; route: string; count: number }>;
  } {
    const all = [...this.entries.values()];
    all.sort((a, b) => a.startedAt - b.startedAt);
    const oldest = all.slice(0, limit).map((entry) => ({
      kind: entry.kind,
      ...(entry.method ? { method: entry.method } : {}),
      route: routeLabel(entry),
      ...(entry.serverAction ? { server_action: true as const } : {}),
      age_s: Math.max(0, Math.round((now - entry.startedAt) / 1000)),
    }));

    const tally = new Map<
      string,
      { kind: InFlightKind; route: string; count: number }
    >();
    for (const entry of all) {
      const route = routeLabel(entry);
      const key = `${entry.kind} ${entry.method ?? ""} ${route}`;
      const cell = tally.get(key);
      if (cell) cell.count++;
      else tally.set(key, { kind: entry.kind, route, count: 1 });
    }
    const by_route = [...tally.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return { oldest, by_route };
  }
}

const ROUTE_LABEL_MAX = 120;
const SEGMENTS_MAX = 8;
const PLAIN_SEGMENT = /^[A-Za-z0-9._~-]{1,40}$/;
const ID_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{16,}$|^\d+$/;

/**
 * A request path as a report label: secret segments scrubbed, id-shaped
 * segments (`:id`) and anything that is not a plain path word (`:x`, which
 * catches the encoded payloads a scanner sends) collapsed, at most eight
 * segments and 120 characters. A job's label is its queue name as is.
 */
export function routeLabel(entry: Pick<InFlightEntry, "kind" | "target">) {
  if (entry.kind === "job") return entry.target.slice(0, ROUTE_LABEL_MAX);
  const segments = redactSecrets(entry.target).split("/");
  const label = segments
    .slice(0, SEGMENTS_MAX + 1)
    .map((segment) => {
      if (segment === "" || segment === "[REDACTED]") return segment;
      if (ID_SEGMENT.test(segment)) return ":id";
      return PLAIN_SEGMENT.test(segment) ? segment : ":x";
    })
    .join("/");
  const suffix = segments.length > SEGMENTS_MAX + 1 ? "/…" : "";
  return (label + suffix).slice(0, ROUTE_LABEL_MAX);
}

const REGISTRY = Symbol.for("healthlog.inFlight.registry");
const HTTP_HOOKED = Symbol.for("healthlog.inFlight.httpHooked");

type Slots = { [REGISTRY]?: InFlightRegistry; [HTTP_HOOKED]?: boolean };

/**
 * The process-wide register. Kept on `globalThis` because Next.js bundles
 * instrumentation, route handlers and the job runner into separate module
 * graphs, and each would otherwise get a register of its own.
 */
export function inFlightRegistry(): InFlightRegistry {
  const slots = globalThis as unknown as Slots;
  return (slots[REGISTRY] ??= new InFlightRegistry());
}

/** Run `fn` as one registered unit of work; the entry goes on any exit. */
export async function trackInFlight<R>(
  entry: Omit<InFlightEntry, "startedAt">,
  fn: () => Promise<R>,
  registry: InFlightRegistry = inFlightRegistry(),
): Promise<R> {
  const id = registry.begin({ ...entry, startedAt: Date.now() });
  try {
    return await fn();
  } finally {
    registry.end(id);
  }
}

interface RequestStartMessage {
  request: IncomingMessage;
  response: ServerResponse;
}

/**
 * Register one accepted request until its response closes. Exported for the
 * tests; the channel subscriber below is the only production caller.
 */
export function trackHttpRequest(
  message: RequestStartMessage,
  registry: InFlightRegistry = inFlightRegistry(),
): void {
  const { request, response } = message;
  const url = request.url ?? "";
  const queryAt = url.indexOf("?");
  const id = registry.begin({
    kind: "http",
    method: request.method ?? "GET",
    target: queryAt === -1 ? url : url.slice(0, queryAt),
    serverAction: request.headers["next-action"] !== undefined,
    startedAt: Date.now(),
  });
  if (id !== 0) response.once("close", () => registry.end(id));
}

/** Hook every HTTP request this process serves. Idempotent per process. */
export function startHttpInFlightTracking(): void {
  const slots = globalThis as unknown as Slots;
  if (slots[HTTP_HOOKED]) return;
  slots[HTTP_HOOKED] = true;
  subscribe("http.server.request.start", (message) => {
    try {
      trackHttpRequest(message as RequestStartMessage);
    } catch {
      // A diagnostic must never break a request.
    }
  });
}
