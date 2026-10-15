"use client";

/**
 * The data behind a link picker over a list that can be long: the records
 * around one date, paged older and newer from there, or a search across the
 * whole history.
 *
 * The pickers used to fetch one capped page, newest first (200 lab results,
 * 100 conditions, ten pages of documents, the last 100 visits), and offered
 * only that. On a long record everything older than the cap could not be
 * linked at all: a visit from 2019 could not reach its own 2019 lab panel.
 *
 * Now a picker opens on the records around the date of the thing being linked
 * (the visit's, the dose's, the document's). The list is split a few days
 * after that date (the same window the "belongs to a visit?" suggestion uses,
 * so a result drawn two days after the visit is on the first page) into two
 * server-side windows:
 *
 *   - `older`: up to the split, newest first, so the record's own days lead
 *     the list, paged further back on request;
 *   - `newer`: after the split, oldest first, fetched only when asked for and
 *     paged further forward from there;
 *
 * and a typed term switches to `search`, which asks the list route itself
 * (`q`) so a match is found wherever it sits in the history. With no date
 * yet the picker opens on the newest records and pages back.
 *
 * Every page comes from the family's own list route through `fetchPage`, so
 * paging, the filter and the ownership check stay server-side.
 */
import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ENCOUNTER_SUGGEST_WINDOW_DAYS } from "@/lib/encounters/suggest-window";

export type PickerDirection = "older" | "newer" | "search";

/** One page of a picker list, and the cursor for the next one (or null). */
export interface PickerPage<T> {
  items: T[];
  next: string | null;
}

export interface PickerPageRequest {
  direction: PickerDirection;
  /** The split instant (ISO), or null when the record has no date yet. */
  pivot: string | null;
  /** The trimmed search term; empty outside `search`. */
  term: string;
  /** The family's own cursor (an offset or a row id), null for page one. */
  cursor: string | null;
}

/** Records per page, the same for every family. */
export const PICKER_PAGE_SIZE = 100;

/** How long typing settles before the search asks the server. */
const SEARCH_DEBOUNCE_MS = 250;

/** Drop repeats by id, keeping the first occurrence's position. */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * The visible list, newest first: the newer pages (fetched oldest first, so
 * reversed) above the older ones.
 */
export function mergeWindowPages<T extends { id: string }>(
  newerPages: ReadonlyArray<PickerPage<T>>,
  olderPages: ReadonlyArray<PickerPage<T>>,
): T[] {
  const newer = newerPages.flatMap((page) => page.items).reverse();
  const older = olderPages.flatMap((page) => page.items);
  return uniqueById([...newer, ...older]);
}

export function useLinkPickerPages<T extends { id: string }>({
  enabled,
  pivot,
  queryKey,
  fetchPage,
  serverSearch = true,
}: {
  enabled: boolean;
  pivot: string | null;
  /** The family's factory key for one direction, pivot and term. */
  queryKey: (
    direction: PickerDirection,
    pivot: string | null,
    term: string,
  ) => readonly unknown[];
  fetchPage: (request: PickerPageRequest) => Promise<PickerPage<T>>;
  /**
   * Whether the list route can search. A route without a text filter (the
   * visit list: its free text is ciphertext at rest) leaves the term to the
   * picker, which filters what is loaded.
   */
  serverSearch?: boolean;
}) {
  const [rawTerm, setTerm] = useState("");
  const debounced = useDebouncedValue(rawTerm.trim(), SEARCH_DEBOUNCE_MS);
  const term = serverSearch ? debounced : "";
  const searching = term.length > 0;

  const older = useInfiniteQuery({
    queryKey: queryKey("older", pivot, ""),
    enabled: enabled && !searching,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchPage({ direction: "older", pivot, term: "", cursor: pageParam }),
    getNextPageParam: (last) => last.next ?? undefined,
  });

  // The newer window is read only once asked for, and only for the split it
  // was asked for: a changed date starts over on the older window.
  const [newerFor, setNewerFor] = useState<string | null>(null);
  const newerRequested = pivot !== null && newerFor === pivot;

  const newer = useInfiniteQuery({
    queryKey: queryKey("newer", pivot, ""),
    // No date, no "after": the older window already starts at the newest.
    enabled: enabled && !searching && newerRequested,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchPage({ direction: "newer", pivot, term: "", cursor: pageParam }),
    getNextPageParam: (last) => last.next ?? undefined,
  });

  const search = useInfiniteQuery({
    queryKey: queryKey("search", null, term),
    enabled: enabled && searching,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchPage({ direction: "search", pivot: null, term, cursor: pageParam }),
    getNextPageParam: (last) => last.next ?? undefined,
  });

  const items = useMemo(() => {
    if (searching) {
      return uniqueById((search.data?.pages ?? []).flatMap((p) => p.items));
    }
    return mergeWindowPages(newer.data?.pages ?? [], older.data?.pages ?? []);
  }, [searching, search.data, newer.data, older.data]);

  const activeError = searching
    ? search.isError
    : older.isError || (newerRequested && newer.isError);

  return {
    items,
    /** The first window is still loading; the inline block shows a skeleton. */
    pending: older.isPending && !searching,
    error: activeError,
    retry: () => {
      if (searching) void search.refetch();
      else {
        void older.refetch();
        if (newerRequested) void newer.refetch();
      }
    },
    term: rawTerm,
    setTerm,
    /** A search is in flight (typed, or its first page not back yet). */
    searchPending:
      serverSearch &&
      (rawTerm.trim() !== term || (searching && search.isPending)),
    /** The picker filters the loaded options by the term itself. */
    filterLocally: !serverSearch,
    hasOlder: searching ? search.hasNextPage : older.hasNextPage,
    // Unknown until asked: offered once for every dated record, then only
    // while the server reports another page.
    hasNewer:
      !searching &&
      pivot !== null &&
      (!newerRequested || newer.isFetching || newer.hasNextPage),
    loadingOlder: searching
      ? search.isFetchingNextPage
      : older.isFetchingNextPage,
    loadingNewer: !searching && newerRequested && newer.isFetching,
    loadOlder: () => {
      if (searching) void search.fetchNextPage();
      else void older.fetchNextPage();
    },
    loadNewer: () => {
      if (searching || pivot === null) return;
      if (!newerRequested) setNewerFor(pivot);
      else void newer.fetchNextPage();
    },
  };
}

export type LinkPickerPages<T extends { id: string }> = ReturnType<
  typeof useLinkPickerPages<T>
>;

/**
 * Where a record's date splits the list: the end of the UTC day
 * {@link ENCOUNTER_SUGGEST_WINDOW_DAYS} days after it, so everything the
 * suggestion window would offer is on the first page. Day-granular so typing
 * the time of a visit does not refetch. Null when there is no date (or it does
 * not parse).
 */
export function pickerPivot(anchor: string | null): string | null {
  if (!anchor) return null;
  const parsed = new Date(anchor);
  if (Number.isNaN(parsed.getTime())) return null;
  const split = new Date(
    parsed.getTime() + ENCOUNTER_SUGGEST_WINDOW_DAYS * 86_400_000,
  );
  split.setUTCHours(23, 59, 59, 999);
  return split.toISOString();
}

/** The instant just after the split, where the newer window starts. */
export function afterPivot(pivot: string): string {
  return new Date(new Date(pivot).getTime() + 1).toISOString();
}

/** Offset cursors, for the list routes that page by `offset`. */
export function nextOffset(
  cursor: string | null,
  received: number,
): string | null {
  if (received < PICKER_PAGE_SIZE) return null;
  return String(Number(cursor ?? "0") + received);
}
