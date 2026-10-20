// Extracted from the former single-file `compliance.ts`. See `../compliance.ts`
// (the barrel) for the module map. Pure move — no logic changes.

import { DOSE_WINDOW_DEFAULTS } from "@/lib/medications/scheduling/dose-window-defaults";
import { localHmAsUtc } from "@/lib/tz/local-day";

export type IntakeTimingClass =
  "early" | "on_time" | "late" | "very_late" | "missed";

/**
 * Parse "HH:mm" into hours and minutes.
 */
function parseHHmm(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(":").map(Number);
  return { hours: h, minutes: m };
}

/**
 * Build the UTC instant of local "HH:mm" in `tz` on the local day of `day`
 * (via {@link localHmAsUtc}), so an "08:00" slot is 08:00 LOCAL.
 */
function toDateOnDay(time: string, day: Date, tz: string): Date {
  const { hours, minutes } = parseHHmm(time);
  return localHmAsUtc(day, tz, hours, minutes);
}

/**
 * Classify how punctual an intake was relative to a schedule window.
 *
 * v1.4.34 — widened pre-window grace from 1h to 3h and introduced
 * a dedicated `early` bucket so a proactive logger (e.g. 10 min before
 * the window) no longer gets flushed into `very_late`. The post-window
 * grace likewise grew to 3h so a "20 minutes late" dose stays `on_time`.
 * Only doses beyond a 3-hour late tolerance fall into `late`, and only
 * doses beyond a further `lateMinutes` tail fall into `very_late`.
 *
 * Buckets:
 * - "early":     within (windowStart - 3h) .. windowStart           (compliant)
 * - "on_time":   windowStart .. (windowEnd + 3h)                    (compliant)
 * - "late":      (windowEnd + 3h) .. (windowEnd + 3h + lateMinutes) (default 2h tail)
 * - "very_late": before windowStart - 3h, or after the late tail
 * - "missed":    takenAt is null
 *
 * Handles overnight windows (windowEnd < windowStart means next day).
 *
 * @param options.lateMinutes Width of the `late` band beyond the 3-hour
 *   on-time tolerance, in minutes. Defaults to 120. Doses past this
 *   tail land in `very_late`.
 * @param options.tz IANA zone the window `HH:mm` is interpreted in, so an
 *   "08:00" slot means 08:00 LOCAL. Required: a UTC fallback was right only
 *   for a UTC user and no caller relied on it.
 */
export function classifyIntakeTiming(
  takenAt: Date | null,
  windowStart: string, // "HH:mm"
  windowEnd: string, // "HH:mm"
  scheduledDate: Date, // the date this was scheduled
  options: { lateMinutes?: number; tz: string },
): IntakeTimingClass {
  if (takenAt === null) return "missed";

  let start = toDateOnDay(windowStart, scheduledDate, options.tz);
  let end = toDateOnDay(windowEnd, scheduledDate, options.tz);

  // A degenerate POINT window (`windowStart === windowEnd` — a single dose time
  // echoed into both fields, a real shape on legacy rows) used to fall into the
  // overnight branch below and inflate into a ~30h on-time band, so a dose taken
  // many hours late still classified `on_time` and fed a perfect-compliance
  // streak. Widen it symmetrically by the default on-time half-width instead,
  // matching `resolveLegacyWindowBounds` in `@/lib/medications/window-status`.
  if (end.getTime() === start.getTime()) {
    const halfMs = DOSE_WINDOW_DEFAULTS.dailyOnTimeMinutes * 60 * 1000;
    start = new Date(start.getTime() - halfMs);
    end = new Date(end.getTime() + halfMs);
  } else if (end < start) {
    // Genuine overnight window (e.g. windowStart="23:00", windowEnd="01:00").
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  const HOUR_MS = 60 * 60 * 1000;
  // 3h pre-window grace: doses inside this window are `early` (still
  // compliant). Doses before it are `very_late`.
  const earlyStart = new Date(start.getTime() - 3 * HOUR_MS);
  // 3h post-window grace: doses up to here are still `on_time`.
  const onTimeEnd = new Date(end.getTime() + 3 * HOUR_MS);
  // Configurable `late` tail past the on-time grace (default 120 min).
  const lateTolerance = (options.lateMinutes ?? 120) * 60 * 1000;
  const lateEnd = new Date(onTimeEnd.getTime() + lateTolerance);

  const t = takenAt.getTime();

  if (t < earlyStart.getTime()) return "very_late";
  if (t < start.getTime()) return "early";
  if (t <= onTimeEnd.getTime()) return "on_time";
  if (t <= lateEnd.getTime()) return "late";
  return "very_late";
}
