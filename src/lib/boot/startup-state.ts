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
 * `null` means no background role was started in this process at all.
 */
export type StartupPhase = "starting" | "ready" | "failed";

const KEY = Symbol.for("healthlog.boot.startupPhase");

export function markStartup(phase: StartupPhase): void {
  (globalThis as Record<symbol, unknown>)[KEY] = phase;
}

export function startupPhase(): StartupPhase | null {
  return ((globalThis as Record<symbol, unknown>)[KEY] as StartupPhase) ?? null;
}
