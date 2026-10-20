/**
 * The `backfillProgress` column of a Google Health connection: how far a
 * full-history backfill has got, carried from one attempt to the next, and
 * where a data type's history ended short of its beginning.
 *
 * One schema reads the column and one function writes it. The column is
 * JSON the code itself wrote, but it outlives releases, so the read is
 * lenient per entry: a malformed cursor or end is dropped on its own and the
 * rest of the note still counts. A collection key longer than 64 characters
 * is never one of ours and is dropped as well.
 */
import { z } from "zod";

import type { MeasurementType } from "@/generated/prisma/client";
import { MeasurementType as MeasurementTypes } from "@/generated/prisma/enums";
import {
  googleHealthBackfillEndIsFinal,
  googleHealthBackfillEndRetryAt,
  type GoogleHealthBackfillEnd,
} from "./backfill-bounds";

/**
 * How far a full-history backfill has got with one collection.
 *
 * Two grains. A collection walked to the end is noted in `done`, and the next
 * attempt skips it. A collection read page by page (the spot readings: heart
 * rate, weight, glucose, ...) also notes, after every page it writes, the
 * edge it has reached: the oldest sample written so far when the walk runs
 * newest first, as Google's list does. The next attempt asks Google only for
 * the samples at or beyond that edge, so a collection that does not fit into
 * one attempt is worked through over several instead of being read from its
 * first page every time.
 *
 * The edge is a sample time, not Google's page token: page tokens are not
 * documented to outlive the walk that received them, a sample time is a
 * filter Google documents. The one sample on the edge itself is read twice
 * and overwrites its own row.
 *
 * Before the edge existed only `done` was kept, and a heart-rate history of
 * years that one attempt could not finish (its budget, a rate limit, one
 * failed page among thousands) started again from the newest page on every
 * attempt and never reached the end (#1220).
 *
 * The upper bound (`<=`) a newest-first walk resumes with is valid filter
 * grammar but has not been seen working against the live API. A collection
 * whose resumed request Google refuses with a 400 is noted in
 * `edgeFilterUnsupported`, and its walks from then on read without the bound
 * and pass over the samples beyond the edge themselves (see
 * `forEachDataPointPage`).
 */
export interface GoogleHealthBackfillCursor {
  /** The edge: the sample instant (ISO 8601) the walk has written up to. */
  at: string;
  /** The order the walk returned samples in: newest first, or oldest first. */
  order: "desc" | "asc";
  /**
   * Pages this collection has written across every attempt so far. Kept for
   * the record only: it bounds nothing. It once capped the walk at ten
   * thousand pages, which a dense heart-rate history passes in under three
   * years, and since it never reset the backfill stopped there for good
   * (#1220). The walk is bounded by its progress and the backfill horizon
   * instead (`backfill-bounds.ts`).
   */
  pages: number;
  /**
   * Only for a collection read without the edge bound: where its last walk
   * stopped in the unbounded list (see `GoogleHealthResumePoint`), and the
   * furthest position any walk of it has saved. A saved place counts as the
   * slice's progress only when it is further than every one before it, so a
   * chain of slices that keep passing over the same pages ends.
   */
  resume?: { token: string; page: number; reached: number };
}

/** Everything the column holds, read. */
export interface GoogleHealthBackfillProgress {
  /** Collections walked to the end. */
  done: Set<string>;
  /** Per-collection edges. */
  cursors: Map<string, GoogleHealthBackfillCursor>;
  /** Collections Google refused the edge filter on. */
  edgeFilterUnsupported: Set<string>;
  /**
   * Collections whose backfill ended short of the start of their history
   * (the horizon, or a walk that stopped getting anywhere), each with where
   * it ended and why. Survives the completion stamp, so the integration card
   * can say where history ends.
   */
  ended: Map<string, GoogleHealthBackfillEnd>;
}

const MAX_KEY_LENGTH = 64;

/** An instant Date can read, normalised to ISO 8601. */
const instant = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)))
  .transform((s) => new Date(s).toISOString());

/** A whole, positive count; anything else reads as zero. */
const count = z
  .unknown()
  .transform((v) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0,
  );

const resumeSchema = z
  .object({ token: z.string().min(1).max(4096), page: count, reached: count })
  .transform((r) =>
    r.page > 0
      ? { token: r.token, page: r.page, reached: Math.max(r.reached, r.page) }
      : undefined,
  );

const cursorSchema = z
  .object({
    at: instant,
    order: z.unknown().transform((v) => (v === "asc" ? "asc" : "desc")),
    pages: count,
    resume: resumeSchema.optional().catch(undefined),
  })
  .transform(({ resume, ...c }): GoogleHealthBackfillCursor =>
    resume ? { ...c, resume } : c,
  );

const endSchema = z
  .object({
    type: z.enum(MeasurementTypes),
    at: instant,
    reason: z.enum(["horizon", "no_progress"]),
    attempts: z.number().int().min(1).optional().catch(undefined),
    endedAt: instant.optional().catch(undefined),
  })
  .transform(({ attempts, endedAt, ...e }): GoogleHealthBackfillEnd => ({
    ...e,
    type: e.type as MeasurementType,
    ...(attempts !== undefined ? { attempts } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
  }));

const record = z.record(z.string(), z.unknown()).catch({});

const keyList = z
  .array(z.unknown())
  .catch([])
  .transform(
    (keys) =>
      new Set(
        keys.filter(
          (key): key is string =>
            typeof key === "string" && key.length <= MAX_KEY_LENGTH,
        ),
      ),
  );

/** Entries of a keyed record that parse, by their own schema, one by one. */
function keyedEntries<T>(value: unknown, schema: z.ZodType<T>): Map<string, T> {
  const out = new Map<string, T>();
  for (const [key, raw] of Object.entries(record.parse(value))) {
    if (key.length > MAX_KEY_LENGTH) continue;
    const parsed = schema.safeParse(raw);
    if (parsed.success) out.set(key, parsed.data);
  }
  return out;
}

/** Read the `backfillProgress` column. */
export function readGoogleHealthBackfillProgress(
  value: unknown,
): GoogleHealthBackfillProgress {
  const column = record.parse(value);
  return {
    done: keyList.parse(column.done),
    cursors: keyedEntries(column.cursors, cursorSchema),
    edgeFilterUnsupported: keyList.parse(column.edgeFilterUnsupported),
    ended: keyedEntries(column.ended, endSchema),
  };
}

/** The ended collections as the column stores them. */
function endedJson(ended: Map<string, GoogleHealthBackfillEnd>) {
  return Object.fromEntries(
    [...ended].map(([key, e]) => [
      key,
      {
        type: e.type,
        at: e.at,
        reason: e.reason,
        ...(e.attempts !== undefined ? { attempts: e.attempts } : {}),
        ...(e.endedAt !== undefined ? { endedAt: e.endedAt } : {}),
      },
    ]),
  );
}

/**
 * The column's value for a backfill in progress. The two optional parts are
 * written only once there is something to say, so a backfill that never met
 * them keeps the shape it always had.
 */
export function googleHealthBackfillProgressJson(
  progress: GoogleHealthBackfillProgress,
) {
  const { done, cursors, edgeFilterUnsupported, ended } = progress;
  return {
    done: [...done],
    cursors: Object.fromEntries(
      [...cursors].map(([key, c]) => [
        key,
        {
          at: c.at,
          order: c.order,
          pages: c.pages,
          ...(c.resume ? { resume: c.resume } : {}),
        },
      ]),
    ),
    ...(edgeFilterUnsupported.size > 0
      ? { edgeFilterUnsupported: [...edgeFilterUnsupported] }
      : {}),
    ...(ended.size > 0 ? { ended: endedJson(ended) } : {}),
  };
}

/**
 * The column's value to keep once the backfill is stamped complete: only
 * where collections ended short for good, or nothing at all.
 */
export function googleHealthBackfillProgressAfterCompletion(
  ended: Map<string, GoogleHealthBackfillEnd>,
): { ended: ReturnType<typeof endedJson> } | null {
  const final = new Map(
    [...ended].filter(([, e]) => googleHealthBackfillEndIsFinal(e)),
  );
  return final.size > 0 ? { ended: endedJson(final) } : null;
}

/**
 * Where each data type's imported history ends short of its beginning, and
 * why, as the status routes publish it (`backfillEnded`), by type.
 */
export interface GoogleHealthBackfillEndedEntry {
  type: MeasurementType;
  /** The oldest instant the imported history reaches back to. */
  endsAt: string;
  reason: GoogleHealthBackfillEnd["reason"];
}

/**
 * The column's ended collections, as published: only the final ends. One
 * still waiting for another attempt is not where its history ends yet.
 */
export function googleHealthBackfillEndedList(
  value: unknown,
): GoogleHealthBackfillEndedEntry[] {
  return [...readGoogleHealthBackfillProgress(value).ended.values()]
    .filter(googleHealthBackfillEndIsFinal)
    .map((e) => ({ type: e.type, endsAt: e.at, reason: e.reason }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/**
 * The collections waiting for another attempt after one ended without
 * progress, and the earliest instant (epoch ms) one of them is due, or null
 * when none waits.
 */
export function googleHealthBackfillRetryPending(
  ended: Map<string, GoogleHealthBackfillEnd>,
): { keys: string[]; dueAt: number } | null {
  const keys: string[] = [];
  let dueAt = Infinity;
  for (const [key, e] of ended) {
    const at = googleHealthBackfillEndRetryAt(e);
    if (at === null) continue;
    keys.push(key);
    dueAt = Math.min(dueAt, at);
  }
  return keys.length > 0 ? { keys, dueAt } : null;
}
