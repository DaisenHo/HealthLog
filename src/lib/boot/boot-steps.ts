/**
 * Named boot steps with their timings, and the step running right now.
 *
 * A stall at boot used to be one number: "the loop was blocked 718 ms". The
 * event-loop monitor now names the step that was running when the late tick
 * fired (`currentBootStep`), and the boot writes one `boot.steps` line with
 * how long each step took, so a slow boot says where its time went.
 *
 * Kept on `globalThis`: the steps are marked from the instrumentation bundle
 * and from the worker modules it loads, which are separate module copies in
 * a production build.
 */
import { withBackgroundEvent } from "@/lib/logging/background";
import { annotate } from "@/lib/logging/context";

export interface BootStep {
  name: string;
  /** Milliseconds since the process started (`performance.timeOrigin`). */
  startedAtMs: number;
  durationMs: number | null;
}

const KEY = Symbol.for("healthlog.boot.steps");

interface State {
  steps: BootStep[];
  current: BootStep | null;
}

function state(): State {
  const slot = globalThis as Record<symbol, unknown>;
  let current = slot[KEY] as State | undefined;
  if (!current) {
    current = { steps: [], current: null };
    slot[KEY] = current;
  }
  return current;
}

/**
 * Begin `name`, ending the step before it. Steps run one after another; a
 * step that starts work in the background ends when the next one begins.
 */
export function beginBootStep(
  name: string,
  now: number = performance.now(),
): void {
  const s = state();
  if (s.current && s.current.durationMs === null) {
    s.current.durationMs = Math.round(now - s.current.startedAtMs);
  }
  const step: BootStep = {
    name,
    startedAtMs: Math.round(now),
    durationMs: null,
  };
  s.steps.push(step);
  s.current = step;
}

/** End the running step without starting another. */
export function endBootSteps(now: number = performance.now()): BootStep[] {
  const s = state();
  if (s.current && s.current.durationMs === null) {
    s.current.durationMs = Math.round(now - s.current.startedAtMs);
  }
  s.current = null;
  return [...s.steps];
}

/** The step running now, or null once the boot is through. */
export function currentBootStep(): string | null {
  return state().current?.name ?? null;
}

/** Every step so far, for the boot line. */
export function bootSteps(): BootStep[] {
  return [...state().steps];
}

/**
 * End the boot and write one `boot.steps` line with every step and its
 * duration, so a slow start says where its time went. Never throws.
 */
export async function reportBootSteps(
  meta: Record<string, string | number> = {},
): Promise<void> {
  const steps = endBootSteps();
  try {
    await withBackgroundEvent("boot.steps", async () => {
      annotate({
        meta: {
          ...meta,
          boot_steps: steps
            .map((s) => `${s.name}=${s.durationMs ?? 0}`)
            .join(","),
          boot_total_ms: Math.round(performance.now()),
        },
      });
    });
  } catch {
    // A diagnostic must never break boot.
  }
}
