/**
 * Where this process is in bringing up its background role.
 *
 * The pg-boss worker (or, in a web-only process, the send-only producer)
 * starts after the HTTP server is already serving: starting it inside
 * `register()` held every request, `/api/health` included, for the seconds
 * pg-boss needs to start, provision its queues and run the boot discovery.
 * The probe reads this to say `starting` while that is under way rather than
 * hanging, and the operator sees a 503 that names a transient state.
 *
 * The window is bounded. A start that has not finished after
 * `STARTING_MAX_MS` is no longer reported as `starting`: it reads `stalled`,
 * the probe drops the reason and says plainly `degraded`, and the process
 * logs one line saying so. An uptime monitor therefore never sees the
 * "transient" label for longer than a real boot takes.
 *
 * `null` means no background role was started in this process at all.
 */
export type StartupPhase = "starting" | "ready" | "failed" | "stalled";

/** Longest a start is still called `starting`. Prod boots take 10–60 s. */
export const STARTING_MAX_MS = 5 * 60_000;

const KEY = Symbol.for("healthlog.boot.startupState");

interface State {
  phase: Exclude<StartupPhase, "stalled">;
  since: number;
}

function state(): State | undefined {
  return (globalThis as Record<symbol, unknown>)[KEY] as State | undefined;
}

export function markStartup(
  phase: Exclude<StartupPhase, "stalled">,
  now: number = Date.now(),
): void {
  (globalThis as Record<symbol, unknown>)[KEY] = { phase, since: now };
}

export function startupPhase(now: number = Date.now()): StartupPhase | null {
  const current = state();
  if (!current) return null;
  if (current.phase === "starting" && now - current.since > STARTING_MAX_MS) {
    return "stalled";
  }
  return current.phase;
}

/** Milliseconds since the current phase began, or null before any start. */
export function startupElapsedMs(now: number = Date.now()): number | null {
  const current = state();
  return current ? now - current.since : null;
}
