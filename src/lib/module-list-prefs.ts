"use client";

/**
 * v1.18.6 — client-side per-module list preferences for the
 * three secondary modules (Vorsorge, Illness, Labs).
 *
 * These modules do not carry a server-side list-layout column the way
 * Medications does (`/api/medications/layout`). Rather than mint three new
 * Prisma columns + routes — which a parallel backend phase owns — the
 * reorder + view choice live in `localStorage`, keyed per module. The choice
 * is presentational only: it reorders / reshapes what the page already
 * fetched and never feeds a server read, so a missing or stale blob degrades
 * to the server's own default order.
 *
 * Shape per module (one localStorage key each):
 *   { view: "cards" | "list", order: string[] }
 * `order` is an id allow-list; ids absent from the live data are ignored and
 * ids present in the data but absent from `order` sort after the ordered
 * block (the server default order is preserved for the tail).
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

export const MODULE_LIST_VIEWS = ["cards", "list"] as const;
export type ModuleListView = (typeof MODULE_LIST_VIEWS)[number];

export type ModuleListKey = "vorsorge" | "illness" | "labs";

/**
 * Sort choice for the Labs surface (MOD-04): order biomarker groups by the
 * recency of their most-recent reading, alphabetically by analyte name
 * (#43), or `manual`, which defers to the persisted `order` array.
 */
export const MODULE_SORT_DIRS = [
  "recentDesc",
  "recentAsc",
  "alphaAsc",
  "alphaDesc",
  "manual",
] as const;
export type ModuleSortDir = (typeof MODULE_SORT_DIRS)[number];

export interface ModuleListPrefs {
  view: ModuleListView;
  order: string[];
  /** Only consumed by the Labs surface; defaults to most-recent-first. */
  sortDir: ModuleSortDir;
}

const DEFAULT_PREFS: ModuleListPrefs = {
  view: "cards",
  order: [],
  sortDir: "recentDesc",
};

/**
 * Per-module default overrides applied when no preference blob is stored yet.
 * Labs defaults to the compact list view (#40) so the dense reading table is
 * the first thing the user sees; Vorsorge and Illness keep the card grid.
 */
const MODULE_DEFAULTS: Partial<
  Record<ModuleListKey, Partial<ModuleListPrefs>>
> = {
  labs: { view: "list" },
};

function defaultsFor(module: ModuleListKey): ModuleListPrefs {
  return { ...DEFAULT_PREFS, ...MODULE_DEFAULTS[module] };
}

function storageKey(module: ModuleListKey): string {
  return `healthlog:module-list-prefs:${module}`;
}

function isView(value: unknown): value is ModuleListView {
  return (
    typeof value === "string" &&
    (MODULE_LIST_VIEWS as readonly string[]).includes(value)
  );
}

function isSortDir(value: unknown): value is ModuleSortDir {
  return (
    typeof value === "string" &&
    (MODULE_SORT_DIRS as readonly string[]).includes(value)
  );
}

export function parseModuleListPrefs(
  raw: string | null,
  defaults: ModuleListPrefs = DEFAULT_PREFS,
): ModuleListPrefs {
  if (!raw) return defaults;
  try {
    const blob = JSON.parse(raw) as Record<string, unknown>;
    const view = isView(blob.view) ? blob.view : defaults.view;
    const order = Array.isArray(blob.order)
      ? blob.order.filter((v): v is string => typeof v === "string")
      : [];
    const sortDir = isSortDir(blob.sortDir) ? blob.sortDir : defaults.sortDir;
    return { view, order, sortDir };
  } catch {
    return defaults;
  }
}

/**
 * Apply a persisted id order to a live list. Items whose id appears in
 * `order` come first in that order; everything else keeps the input order
 * (the server default) after the ordered block. Ids in `order` but absent
 * from the data are silently dropped.
 */
export function applyOrder<T>(
  items: readonly T[],
  order: readonly string[],
  idOf: (item: T) => string,
): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map(order.map((id, i) => [id, i]));
  const ordered: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (rank.has(idOf(item))) ordered.push(item);
    else rest.push(item);
  }
  ordered.sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
  return [...ordered, ...rest];
}

// A module-scoped event so every mounted hook for the same module repaints
// when one writer flushes a change (the settings page + the module page can
// both be alive across a client navigation without a full reload).
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

/**
 * Read + write the per-module list preferences. SSR-safe via
 * `useSyncExternalStore` with a null server snapshot (parsed to defaults).
 */
export function useModuleListPrefs(module: ModuleListKey): {
  prefs: ModuleListPrefs;
  setView: (view: ModuleListView) => void;
  setOrder: (order: string[]) => void;
  setSortDir: (sortDir: ModuleSortDir) => void;
} {
  const key = storageKey(module);
  const defaults = useMemo(() => defaultsFor(module), [module]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) onChange();
      };
      if (typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(onChange);
        if (typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  }, [key]);

  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  // `useSyncExternalStore` returns a stable `raw` string when storage hasn't
  // changed, so keying the parse on it gives downstream `applyOrder`
  // memoisation a stable `prefs` reference instead of a fresh object + a
  // JSON.parse on every render.
  const prefs = useMemo(
    () => parseModuleListPrefs(raw, defaults),
    [raw, defaults],
  );

  const write = useCallback(
    (next: ModuleListPrefs) => {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(key, JSON.stringify(next));
      emit();
    },
    [key],
  );

  const setView = useCallback(
    (view: ModuleListView) =>
      write({ ...parseModuleListPrefs(getSnapshot(), defaults), view }),
    [write, getSnapshot, defaults],
  );
  const setOrder = useCallback(
    (order: string[]) =>
      write({ ...parseModuleListPrefs(getSnapshot(), defaults), order }),
    [write, getSnapshot, defaults],
  );
  const setSortDir = useCallback(
    (sortDir: ModuleSortDir) =>
      write({ ...parseModuleListPrefs(getSnapshot(), defaults), sortDir }),
    [write, getSnapshot, defaults],
  );

  return { prefs, setView, setOrder, setSortDir };
}
