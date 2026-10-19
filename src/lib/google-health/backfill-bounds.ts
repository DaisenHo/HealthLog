/**
 * How far a Google Health list walk is allowed to go, expressed in what the
 * walk actually reaches rather than in how many pages it has read (#1220).
 *
 * Two bounds:
 *
 *   - **Progress.** A walk that keeps reading pages but no longer reaches any
 *     further back in time (Google handing out the same page again, or a
 *     page token that cycles) is a runaway. It is stopped after
 *     `GOOGLE_HEALTH_NO_PROGRESS_PAGES` such pages in a row. A walk that
 *     moves to older readings on every page is never stopped by this,
 *     however long the history is.
 *   - **Horizon.** A history backfill reads back at most
 *     `GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS` years (twenty unless the
 *     operator sets the variable), so even a walk that does progress has an
 *     end that does not depend on how densely the device records.
 *
 * Before, a backfill counted every page a data type had read across all of
 * its slices and stopped at ten thousand. A watch that records heart rate
 * every few seconds fills some four thousand pages a year, so the count ran
 * out about two and a half years back, and since it never reset, every later
 * slice stopped at the same place and the backfill was never marked complete.
 */
import type { MeasurementType } from "@/generated/prisma/client";
import { envValue } from "@/lib/env";

/**
 * Pages in a row that may fail to reach past the furthest reading the walk
 * has seen before the walk is taken for a runaway and stopped. A real
 * history moves on every page (a page is up to a thousand readings), so this
 * only ever counts pages that repeat what came before.
 */
export const GOOGLE_HEALTH_NO_PROGRESS_PAGES = 20;

/** The backfill horizon when `GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS` is unset. */
const DEFAULT_HORIZON_YEARS = 20;
const MAX_HORIZON_YEARS = 100;

/**
 * How many years back a history backfill reads: the operator's
 * `GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS` when it is a whole number from 1 to
 * 100, else twenty.
 */
export function googleHealthBackfillHorizonYears(): number {
  const raw = envValue("GOOGLE_HEALTH_BACKFILL_HORIZON_YEARS");
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_HORIZON_YEARS;
  const years = Number.parseInt(raw, 10);
  return years >= 1 && years <= MAX_HORIZON_YEARS
    ? years
    : DEFAULT_HORIZON_YEARS;
}

/** The oldest instant a backfill started at `now` reads back to. */
export function googleHealthBackfillHorizon(now: Date = new Date()): Date {
  const horizon = new Date(now);
  horizon.setUTCFullYear(
    horizon.getUTCFullYear() - googleHealthBackfillHorizonYears(),
  );
  return horizon;
}

/**
 * Where one walk has got to in time. `order` is the order Google returns the
 * readings in (newest first unless a page shows otherwise); `furthest` is the
 * oldest reading seen so far on a newest-first walk, the newest on an
 * oldest-first one; `stalled` counts the pages in a row that did not reach
 * past it.
 */
export interface GoogleHealthWalkProgress {
  order: "desc" | "asc" | null;
  furthest: number | null;
  stalled: number;
}

/**
 * A fresh progress note. A walk that resumes from an edge with the edge as a
 * filter starts from it, so a page that only repeats readings at or beyond
 * the edge does not count as getting anywhere.
 */
export function googleHealthWalkProgress(
  from?: { at: Date; order: "desc" | "asc" } | null,
): GoogleHealthWalkProgress {
  return from
    ? { order: from.order, furthest: from.at.getTime(), stalled: 0 }
    : { order: null, furthest: null, stalled: 0 };
}

/**
 * Note one page, given the sample instants of its readings in the order
 * Google returned them (null for a reading without a readable time). Returns
 * true once the walk has gone `GOOGLE_HEALTH_NO_PROGRESS_PAGES` pages in a
 * row without reaching further. A page with no readable instant at all
 * reaches nowhere and counts toward the limit.
 */
export function noteGoogleHealthWalkPage(
  progress: GoogleHealthWalkProgress,
  instants: ReadonlyArray<number | null>,
): boolean {
  let first: number | null = null;
  let last: number | null = null;
  let min = Infinity;
  let max = -Infinity;
  for (const t of instants) {
    if (t === null) continue;
    first ??= t;
    last = t;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (progress.order === null && first !== null && last !== null) {
    if (first !== last) progress.order = first < last ? "asc" : "desc";
  }
  const order = progress.order ?? "desc";
  const far = first === null ? null : order === "desc" ? min : max;
  const moved =
    far !== null &&
    (progress.furthest === null ||
      (order === "desc" ? far < progress.furthest : far > progress.furthest));
  if (moved) {
    progress.furthest = far;
    progress.stalled = 0;
  } else {
    progress.stalled += 1;
  }
  return progress.stalled >= GOOGLE_HEALTH_NO_PROGRESS_PAGES;
}

/**
 * Why a backfill stopped reading a data type before the end of its history:
 * it reached the horizon, or Google stopped handing out older readings.
 */
export type GoogleHealthBackfillEndReason = "horizon" | "no_progress";

/**
 * A data type whose backfill ended short of the history's beginning, and
 * where: the oldest instant the import reaches back to.
 */
export interface GoogleHealthBackfillEnd {
  /** The measurement type whose history this is. */
  type: MeasurementType;
  at: string;
  reason: GoogleHealthBackfillEndReason;
  /**
   * `no_progress` only: how many separate attempts have ended this way, and
   * when the last one did (see `googleHealthBackfillEndIsFinal`).
   */
  attempts?: number;
  endedAt?: string;
}

/**
 * Separate attempts that must end without progress before a data type's
 * history counts as ending there. One is not enough: Google handing out the
 * same page for a while is as likely a passing fault in its paging as the end
 * of what it holds, and a reconnect would be the only way back.
 */
export const GOOGLE_HEALTH_NO_PROGRESS_ATTEMPTS = 2;

/** How long after an attempt ended without progress the next one starts. */
export const GOOGLE_HEALTH_NO_PROGRESS_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an end is where the history stays: always at the horizon, and
 * after `GOOGLE_HEALTH_NO_PROGRESS_ATTEMPTS` attempts without progress.
 * Until then the data type waits for its next attempt, unfinished, and is not
 * published as ending anywhere.
 */
export function googleHealthBackfillEndIsFinal(
  end: GoogleHealthBackfillEnd,
): boolean {
  return (
    end.reason === "horizon" ||
    (end.attempts ?? 1) >= GOOGLE_HEALTH_NO_PROGRESS_ATTEMPTS
  );
}

/**
 * When an end that is not final may be walked again (epoch ms), or null for
 * a final one. An end without a readable time is due at once.
 */
export function googleHealthBackfillEndRetryAt(
  end: GoogleHealthBackfillEnd,
): number | null {
  if (googleHealthBackfillEndIsFinal(end)) return null;
  const endedAt = end.endedAt ? Date.parse(end.endedAt) : Number.NaN;
  return Number.isNaN(endedAt)
    ? 0
    : endedAt + GOOGLE_HEALTH_NO_PROGRESS_RETRY_MS;
}
