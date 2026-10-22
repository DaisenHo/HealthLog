/**
 * The `ouraBackfillProgress` column: how far the Oura history backfill has
 * got, carried from one slice to the next.
 *
 * Each collection is walked from the day the backfill began (`anchor`) back
 * toward the start of the account's history, one window at a time. After a
 * window is written its start becomes the collection's `before`, and the next
 * window ends there, so a slice that stops (its budget, a rate limit, a failed
 * window) loses at most the window it was in, and the next slice goes on from
 * the last one written instead of from the newest day. A collection that
 * reached the start of history is `done`; one the grant does not cover is
 * `denied` and is asked for again by the first slice of the next chain.
 *
 * Where history starts is learned, not assumed: `activity` and `sleep` are
 * walked first, back to `OURA_HISTORY_FLOOR`, and the oldest day either
 * returned (`oldestSeen`) becomes `historyStart`. Every other collection stops
 * a week before it, so an account with two years of history costs two years of
 * requests, not eleven.
 *
 * The column is JSON the code wrote, read leniently: a malformed entry is
 * dropped on its own and that collection starts over from the anchor, which
 * is safe because every write is keyed.
 */
import { z } from "zod";

import type { OuraCollectionName } from "./scope";

/** The oldest day any Oura ring could have recorded (the first ring shipped in 2015). */
export const OURA_HISTORY_FLOOR = "2015-01-01";

export interface OuraBackfillCollectionState {
  /** Upper bound (YYYY-MM-DD) of the next window to read. */
  before: string;
  done?: boolean;
  denied?: boolean;
  /** Windows written across every slice, for the record only. */
  windows?: number;
}

export interface OuraBackfillProgress {
  anchor: string;
  /** Oldest day `activity` or `sleep` returned so far. */
  oldestSeen?: string;
  /**
   * Where the account's history starts, once `activity` and `sleep` are both
   * walked to the floor; `null` when they found nothing at all.
   */
  historyStart?: string | null;
  /** The legacy equivalent-distance rows are retired. */
  distanceRetired?: boolean;
  collections: Partial<Record<OuraCollectionName, OuraBackfillCollectionState>>;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const stateSchema = z.object({
  before: day,
  done: z.boolean().optional().catch(undefined),
  denied: z.boolean().optional().catch(undefined),
  windows: z.number().int().min(0).optional().catch(undefined),
});

/** Read the column; null when there is no usable progress yet. */
export function readOuraBackfillProgress(
  value: unknown,
  known: readonly OuraCollectionName[],
): OuraBackfillProgress | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const anchor = day.safeParse(raw.anchor);
  if (!anchor.success) return null;
  const collections: OuraBackfillProgress["collections"] = {};
  const rawCollections =
    raw.collections && typeof raw.collections === "object"
      ? (raw.collections as Record<string, unknown>)
      : {};
  for (const name of known) {
    const parsed = stateSchema.safeParse(rawCollections[name]);
    if (parsed.success) {
      const s = parsed.data;
      collections[name] = {
        before: s.before,
        ...(s.done ? { done: true } : {}),
        ...(s.denied ? { denied: true } : {}),
        ...(s.windows !== undefined ? { windows: s.windows } : {}),
      };
    }
  }
  const oldestSeen = day.safeParse(raw.oldestSeen);
  const historyStart =
    raw.historyStart === null ? null : day.safeParse(raw.historyStart);
  return {
    anchor: anchor.data,
    ...(oldestSeen.success ? { oldestSeen: oldestSeen.data } : {}),
    ...(historyStart === null
      ? { historyStart: null }
      : historyStart.success
        ? { historyStart: historyStart.data }
        : {}),
    ...(raw.distanceRetired === true ? { distanceRetired: true } : {}),
    collections,
  };
}

/** The column's value for a progress note. */
export function ouraBackfillProgressJson(progress: OuraBackfillProgress) {
  return {
    anchor: progress.anchor,
    ...(progress.oldestSeen ? { oldestSeen: progress.oldestSeen } : {}),
    ...(progress.historyStart !== undefined
      ? { historyStart: progress.historyStart }
      : {}),
    ...(progress.distanceRetired ? { distanceRetired: true } : {}),
    collections: Object.fromEntries(
      Object.entries(progress.collections).map(([name, s]) => [
        name,
        {
          before: s!.before,
          ...(s!.done ? { done: true } : {}),
          ...(s!.denied ? { denied: true } : {}),
          ...(s!.windows !== undefined ? { windows: s!.windows } : {}),
        },
      ]),
    ),
  };
}

/** The progress with every `denied` mark cleared, for a fresh grant. */
export function withoutDenied(
  progress: OuraBackfillProgress,
): OuraBackfillProgress {
  return {
    ...progress,
    collections: Object.fromEntries(
      Object.entries(progress.collections).map(([name, s]) => {
        const { denied: _denied, ...rest } = s!;
        return [name, rest];
      }),
    ),
  };
}
