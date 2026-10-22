import { currentBootStep } from "@/lib/boot/boot-steps";
import { startupPhase } from "@/lib/boot/startup-state";
import { WideEventBuilder } from "@/lib/logging/event-builder";
import { emitIfSampled } from "@/lib/logging/transports";

import { inFlightRegistry } from "./in-flight";

/**
 * Event-loop lag monitor — the instance-level "was the PROCESS stalled"
 * signal that per-request durations cannot carry.
 *
 * Motivation: production showed multi-second windows where every
 * response — API routes, RSC payloads, even static assets — waited
 * together while the handler durations logged in the same window stayed
 * under half a second. That shape means the Node event loop itself (or
 * its host) stopped turning; no per-route metric can name the culprit
 * because nothing route-shaped is slow. This monitor (a) emits a
 * dedicated wide event whenever a tick fires late enough to call a
 * stall, (b) publishes the recent worst lag for every wide event to
 * carry, so the first request finishing after a stall is annotated
 * with it.
 *
 * Measurement: a self-rescheduling timeout records how late each tick
 * fired versus its scheduled instant. A blocked loop cannot fire the
 * tick, so the stall length lands in the very next tick's lag. This is
 * deliberately NOT `perf_hooks.monitorEventLoopDelay` — its internal
 * sampling timer races a sibling read-and-reset interval inside the
 * same timers phase, and the stall sample can vanish into the window
 * that was just reset (reproduced under vitest).
 *
 * Attribution: a stall line says what the process was doing. It carries the
 * process uptime, the background role's startup phase, the boot step that
 * was running (`boot-steps.ts`), and the oldest requests and jobs in flight
 * with the routes most of them share, the same report the heap pressure line
 * writes. The monitor is the first thing `register()` starts, so the loading
 * of the database client and of the worker graph is inside its view.
 *
 * The snapshot is published on a `globalThis` slot rather than imported
 * by the event builder: the builder is bundled into the Edge-runtime
 * proxy, and reading a global keeps the dependency one-directional
 * (monitor → global ← builder) and edge-safe by construction.
 */

export interface EventLoopLagSnapshot {
  /** Worst tick lag (ms) across the recent snapshot horizon. */
  loop_max_ms: number;
  /** Lag (ms) of the most recent tick. */
  loop_last_ms: number;
}

export const EVENT_LOOP_LAG_GLOBAL = Symbol.for("healthlog.eventLoopLag");

/**
 * 250 ms ticks: fine enough that any stall ≥ the 500 ms threshold MUST
 * delay a tick (a stall can hide from a coarse cadence by fitting
 * between two fires), cheap enough to run always — four unref'd timer
 * wakeups per second. The snapshot horizon keeps the worst lag of the
 * last ~2 s so the first requests finishing after a stall carry it.
 */
const TICK_INTERVAL_MS = 250;
const STALL_THRESHOLD_MS = 500;
const SNAPSHOT_HORIZON_TICKS = 8;
const STARTED = Symbol.for("healthlog.eventLoopLag.started");

type GlobalSlots = {
  [EVENT_LOOP_LAG_GLOBAL]?: EventLoopLagSnapshot;
  [STARTED]?: boolean;
};

/** What a stall line says. */
export interface EventLoopStall {
  lag_ms: number;
  tick_interval_ms: number;
  uptime_s: number;
  startup_phase: string | null;
  boot_step: string | null;
  in_flight_oldest: unknown[];
  in_flight_by_route: unknown[];
}

export interface EventLoopLagMonitorOptions {
  tickIntervalMs?: number;
  stallThresholdMs?: number;
  /** Test seam — replaces the wide-event emit. */
  emitStall?: (stall: EventLoopStall) => void;
}

/** The attribution a stall carries; never throws. */
export function stallAttribution(
  now: number = Date.now(),
): Omit<EventLoopStall, "lag_ms" | "tick_interval_ms"> {
  let inFlight: { oldest: unknown[]; by_route: unknown[] } = {
    oldest: [],
    by_route: [],
  };
  try {
    inFlight = inFlightRegistry().report(now, 5);
  } catch {
    // The report is a garnish.
  }
  return {
    uptime_s: Math.round(process.uptime() * 10) / 10,
    startup_phase: startupPhase(now),
    boot_step: currentBootStep(),
    in_flight_oldest: inFlight.oldest,
    in_flight_by_route: inFlight.by_route,
  };
}

function defaultEmitStall(stall: EventLoopStall): void {
  const evt = new WideEventBuilder("background");
  evt.setBackground({
    task_name: "event_loop_stall",
    result: stall as unknown as Record<string, unknown>,
  });
  evt.elevateLevel("warn");
  evt.finish();
  emitIfSampled(evt.toJSON());
}

/**
 * Start the monitor. Idempotent per process — hot reload in dev and the
 * dual web+worker boot path both call it without stacking timers. The
 * timeout chain is unref'd so it never holds the process open.
 */
export function startEventLoopLagMonitor(
  options: EventLoopLagMonitorOptions = {},
): void {
  const slots = globalThis as unknown as GlobalSlots;
  if (slots[STARTED]) return;
  slots[STARTED] = true;

  const {
    tickIntervalMs = TICK_INTERVAL_MS,
    stallThresholdMs = STALL_THRESHOLD_MS,
    emitStall = defaultEmitStall,
  } = options;

  const recentLags: number[] = [];
  let scheduledAt = performance.now() + tickIntervalMs;

  const tick = () => {
    const now = performance.now();
    const lagMs = Math.max(0, now - scheduledAt);

    recentLags.push(lagMs);
    if (recentLags.length > SNAPSHOT_HORIZON_TICKS) recentLags.shift();
    slots[EVENT_LOOP_LAG_GLOBAL] = {
      loop_max_ms: Math.round(Math.max(...recentLags) * 10) / 10,
      loop_last_ms: Math.round(lagMs * 10) / 10,
    };

    if (lagMs >= stallThresholdMs) {
      emitStall({
        lag_ms: Math.round(lagMs),
        tick_interval_ms: tickIntervalMs,
        ...stallAttribution(),
      });
    }

    scheduledAt = performance.now() + tickIntervalMs;
    const timer = setTimeout(tick, tickIntervalMs);
    timer.unref();
  };

  const timer = setTimeout(tick, tickIntervalMs);
  timer.unref();
}

/**
 * Recent worst tick lag, or null before the first tick (and on runtimes
 * where the monitor never starts, e.g. Edge). Read by the wide-event
 * builder via the global slot — see the module header.
 */
export function eventLoopLagSnapshot(): EventLoopLagSnapshot | null {
  const slots = globalThis as unknown as GlobalSlots;
  return slots[EVENT_LOOP_LAG_GLOBAL] ?? null;
}
