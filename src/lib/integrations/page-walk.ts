/**
 * The one way a provider client walks a paged collection, and the contract a
 * history backfill reads off it.
 *
 * Every client used to keep its own `while (pages < MAX)` loop, and each one
 * ended the same way at its ceiling: it returned what it had read, said
 * nothing, and the backfill around it stamped the connection complete. A
 * history longer than the ceiling, or a cursor that never advanced, was cut
 * off for good without a trace. `walkPages` keeps the ceiling, because a
 * runaway cursor must stop somewhere, but a walk that stops with a page still
 * pending, or on a cursor it has already followed, reports itself
 * `truncated`: on the run's wide event, and in the ledger a backfill opens
 * with `withPageWalkLedger`.
 *
 * The backfill contract (`backfillVerdict`), the same for every provider:
 *   - a failed collection is transient: the job throws and pg-boss retries;
 *   - a truncated collection is not complete: the marker is not stamped, and
 *     boot discovery offers the account again, without a retry storm;
 *   - a connection parked for re-authorisation is permanent until the person
 *     reconnects: the runner returns without stamping and without a retry.
 *
 * Google Health's dailyRollUp chunks walk through here. Its `dataPoints.list`
 * walk (`forEachDataPointPage`) stays outside on purpose: it is bounded by
 * progress in time rather than by a cursor ceiling (`google-health/
 * backfill-bounds.ts`), streams pages instead of collecting them, stops on a
 * backfill slice's budget and keeps its place for the next slice, and its
 * backfill decides with a sliced verdict these three outcomes cannot carry.
 * `src/__tests__/page-walk-guard.test.ts` keeps hand-rolled page loops out of
 * the provider directories and names that one exception with its reasons.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { annotate } from "@/lib/logging/context";

/** One page as the client read it. A null `next` ends the walk. */
export interface WalkPage<C, T> {
  items: readonly T[];
  next: C | null | undefined;
}

/** What the walk came to. */
export interface PageWalk<T> {
  items: T[];
  pages: number;
  /** Stopped at the ceiling or on a repeated cursor with history left. */
  truncated: boolean;
}

const ledger = new AsyncLocalStorage<Set<string>>();

/**
 * Walk `fetchPage` from `first` (or no cursor) until a page has no `next`,
 * at most `maxPages` pages. `label` names the collection (`whoop.recovery`)
 * on the wide event and in the ledger.
 */
export async function walkPages<C, T>(
  label: string,
  maxPages: number,
  fetchPage: (cursor: C | undefined, page: number) => Promise<WalkPage<C, T>>,
  first?: C,
): Promise<PageWalk<T>> {
  const items: T[] = [];
  const seen = new Set<C>(first === undefined ? [] : [first]);
  let cursor = first;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor, page);
    items.push(...result.items);
    const next = result.next;
    if (next === null || next === undefined) {
      return { items, pages: page + 1, truncated: false };
    }
    if (seen.has(next)) return truncated(label, items, page + 1, "repeat");
    seen.add(next);
    cursor = next;
  }
  return truncated(label, items, maxPages, "ceiling");
}

function truncated<T>(
  label: string,
  items: T[],
  pages: number,
  reason: "ceiling" | "repeat",
): PageWalk<T> {
  annotate({
    action: { name: "integration.page_walk.truncated" },
    meta: { walk: label, pages, reason },
  });
  ledger.getStore()?.add(label);
  return { items, pages, truncated: true };
}

/**
 * Run `run` with a ledger of the walks inside it that ended truncated. A
 * backfill wraps its full sync in this and reads the ledger before it
 * stamps its marker.
 */
export async function withPageWalkLedger<R>(
  run: () => Promise<R>,
): Promise<{ result: R; truncated: string[] }> {
  const walks = new Set<string>();
  const result = await ledger.run(walks, run);
  return { result, truncated: [...walks].sort() };
}

/** What a backfill does with its full sync's outcome. */
export type BackfillVerdict = "complete" | "retry" | "incomplete";

export function backfillVerdict(outcome: {
  failed: boolean;
  truncated: readonly string[];
}): BackfillVerdict {
  if (outcome.failed) return "retry";
  return outcome.truncated.length > 0 ? "incomplete" : "complete";
}
