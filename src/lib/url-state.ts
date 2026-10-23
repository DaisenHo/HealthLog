"use client";

/**
 * The one way a page writes its own state into the query string.
 *
 * Next 16.4 adopts a native `history.pushState` / `replaceState` a render
 * after the write: its router commits its copy of the URL then, and
 * `useSearchParams` follows only at that commit. Two things went wrong
 * around that gap, on every surface that kept state in the URL:
 *
 *   - a second write that landed inside the gap was undone when the router
 *     adopted the first one and put the first URL back (`[` then `]` on the
 *     day ended a day short; clearing the document filters left
 *     `?encounter=` behind);
 *   - a write computed from `useSearchParams` started from the URL before
 *     the previous write, and so wrote the old parameters back.
 *
 * So every write here derives from the live address bar at the moment it is
 * made, never from a rendered copy, and at most one write is in flight at a
 * time: while the router has not adopted the last one, further updates are
 * queued and applied together, on top of it, once it has (or after a short
 * grace when no reader reports it). Readers go through `useUrlSearch`, which
 * reads the same live value, including updates still queued, and reports
 * each adoption back.
 *
 * Writes the page makes as it mounts (stripping a one-shot `?add=`) pass
 * `afterPaint`: the router installs its native-history integration a frame
 * or two after the first effects run, and a write before that loses the
 * router's own entry state.
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";

export type UrlStateUpdate = (params: URLSearchParams) => void;

export interface UrlStateWriteOptions {
  /** A new history entry (`push`) or the current one rewritten (`replace`). */
  mode?: "push" | "replace";
  /**
   * The history entry's state: an object to store, or `"keep"` for the
   * current entry's own state. Defaults to `null`, which the router fills
   * with its own.
   */
  state?: unknown;
  /** Wait two painted frames before writing (a write made while mounting). */
  afterPaint?: boolean;
  /** Write to this path instead of the current one (same page, new path). */
  pathname?: string;
}

/** How long a write waits for the router to report it before the next goes. */
export const ADOPTION_GRACE_MS = 250;

/** The event every write dispatches, so `useUrlSearch` re-reads at once. */
export const URL_STATE_EVENT = "healthlog:url-state";

interface Queued {
  updates: UrlStateUpdate[];
  mode: "push" | "replace";
  state: unknown;
  pathname: string | null;
}

/** The query string written last and not yet adopted by the router. */
let inFlight: string | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let queued: Queued | null = null;

function normalise(search: string): string {
  if (search === "" || search === "?") return "";
  return search.startsWith("?") ? search : `?${search}`;
}

function applyUpdates(
  search: string,
  updates: readonly UrlStateUpdate[],
): string {
  const params = new URLSearchParams(search);
  for (const update of updates) update(params);
  return normalise(params.toString());
}

function notify(): void {
  window.dispatchEvent(new Event(URL_STATE_EVENT));
}

function armGrace(): void {
  if (graceTimer !== null) clearTimeout(graceTimer);
  graceTimer = setTimeout(() => {
    graceTimer = null;
    settle();
  }, ADOPTION_GRACE_MS);
}

/** The router has the last write (or the grace ran out): send what waits. */
function settle(): void {
  inFlight = null;
  if (graceTimer !== null) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  const next = queued;
  queued = null;
  if (next) commit(next.updates, next.mode, next.state, next.pathname);
}

function commit(
  updates: readonly UrlStateUpdate[],
  mode: "push" | "replace",
  state: unknown,
  pathname: string | null,
): void {
  const { location, history } = window;
  const search = applyUpdates(location.search, updates);
  const path = pathname ?? location.pathname;
  if (search === normalise(location.search) && path === location.pathname) {
    notify();
    return;
  }
  const entryState = state === "keep" ? history.state : (state ?? null);
  const href = `${path}${search}${location.hash}`;
  if (mode === "push") history.pushState(entryState, "", href);
  else history.replaceState(entryState, "", href);
  // A write that keeps the router's own entry state is one the router does
  // not adopt (it reads it as its own), so nothing waits for it.
  if (state !== "keep") {
    inFlight = search;
    armGrace();
  }
  notify();
}

/**
 * Change the query string. `update` receives the live parameters (with any
 * update still queued already applied) and edits them in place.
 */
export function writeUrlState(
  update: UrlStateUpdate,
  options: UrlStateWriteOptions = {},
): void {
  if (typeof window === "undefined") return;
  const mode = options.mode ?? "replace";
  if (options.afterPaint) {
    const { afterPaint: _deferred, ...rest } = options;
    void _deferred;
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => writeUrlState(update, rest)),
    );
    return;
  }
  const pathname = options.pathname ?? null;
  if (inFlight !== null) {
    queued = {
      updates: [...(queued?.updates ?? []), update],
      // One coalesced write: a new entry if any of them asked for one.
      mode: queued?.mode === "push" || mode === "push" ? "push" : "replace",
      state: options.state ?? queued?.state ?? null,
      pathname: pathname ?? queued?.pathname ?? null,
    };
    notify();
    return;
  }
  commit([update], mode, options.state ?? null, pathname);
}

/**
 * Write a whole same-origin href (path and query) computed by a page's own
 * URL builder. Prefer `writeUrlState` with an update for state derived from
 * the current query: this form replaces the query outright.
 */
export function writeUrlHref(
  href: string,
  options: Omit<UrlStateWriteOptions, "pathname"> = {},
): void {
  if (typeof window === "undefined") return;
  const target = new URL(href, window.location.href);
  writeUrlState(setAllParams(target.search), {
    ...options,
    pathname: target.pathname,
  });
}

/**
 * A `history`-shaped view for code written against the History API (the
 * vault's close path takes one, so its tests can pass a fake): `state` and
 * `back` are the browser's, `replaceState` goes through `writeUrlState`.
 */
export const urlStateHistory = {
  get state(): unknown {
    return window.history.state;
  },
  back(): void {
    window.history.back();
  },
  replaceState(data: unknown, _unused: string, url?: string | URL | null) {
    if (url === undefined || url === null) return;
    writeUrlHref(String(url), { mode: "replace", state: data });
  },
};

/** Drop the named parameters (a one-shot `?add=`, an OAuth outcome). */
export function dropParams(...keys: string[]): UrlStateUpdate {
  return (params) => {
    for (const key of keys) params.delete(key);
  };
}

/** Replace every parameter with `search` (a list's whole filter state). */
export function setAllParams(search: string): UrlStateUpdate {
  return (params) => {
    for (const key of [...params.keys()]) params.delete(key);
    new URLSearchParams(search).forEach((value, key) => {
      params.append(key, value);
    });
  };
}

/**
 * The live query string, `?`-prefixed or empty: the address bar with any
 * update still waiting in the queue applied on top.
 */
export function currentUrlSearch(): string {
  if (typeof window === "undefined") return "";
  const live = normalise(window.location.search);
  return queued ? applyUpdates(live, queued.updates) : live;
}

/**
 * The router's `useSearchParams` now shows `search`. Called by every
 * `useUrlSearch` reader; once it matches the write in flight, the queue
 * moves.
 */
export function reportRouterSearch(search: string): void {
  if (inFlight !== null && normalise(search) === inFlight) settle();
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(URL_STATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(URL_STATE_EVENT, onChange);
  };
}

/**
 * The page's query parameters, read live: the address bar (and any queued
 * update) rather than the router's copy, which trails a write by a render.
 * Before hydration the router's copy stands in.
 */
export function useUrlSearch(): URLSearchParams {
  const routerParams = useSearchParams();
  const routerSearch = normalise(routerParams?.toString() ?? "");
  useEffect(() => {
    reportRouterSearch(routerSearch);
  }, [routerSearch]);
  const search = useSyncExternalStore(
    subscribe,
    currentUrlSearch,
    () => routerSearch,
  );
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Test seam: forget any write in flight or queued. */
export function resetUrlStateForTests(): void {
  inFlight = null;
  queued = null;
  if (graceTimer !== null) clearTimeout(graceTimer);
  graceTimer = null;
}
