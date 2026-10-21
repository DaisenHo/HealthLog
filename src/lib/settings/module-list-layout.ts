/**
 * List presentation for the labs, illness and checkups lists, persisted in
 * `User.moduleListLayoutJson`.
 *
 * Three independent choices per list, all display-only:
 *
 * - `view`: the card grid or the compact list.
 * - `order`: an id allow-list. Ids absent from the live data are ignored;
 *   ids present in the data but absent from `order` sort after the ordered
 *   block in the server's own order.
 * - `sortDir`: only the labs list reads it (recency, alphabetical, or the
 *   manual `order`).
 *
 * Null / missing column = the defaults below. The GET never lazy-writes, and
 * the PUT stores only the fields a person has actually chosen, so a default
 * that changes later still reaches every list nobody arranged. Mirrors
 * `documents-layout.ts`: tolerant resolver on read, preserve-when-absent PUT.
 *
 * `saved` tells the client whether the server holds a choice for a list. The
 * same choices lived in the browser before this column existed; the client
 * copies a browser value up once, only while `saved` is false, so an order a
 * person built is carried over instead of reset.
 */

export const MODULE_LIST_KEYS = ["labs", "illness", "vorsorge"] as const;
export type ModuleListKey = (typeof MODULE_LIST_KEYS)[number];

export const MODULE_LIST_VIEWS = ["cards", "list"] as const;
export type ModuleListView = (typeof MODULE_LIST_VIEWS)[number];

export const MODULE_SORT_DIRS = [
  "recentDesc",
  "recentAsc",
  "alphaAsc",
  "alphaDesc",
  "manual",
] as const;
export type ModuleSortDir = (typeof MODULE_SORT_DIRS)[number];

/** Longest order a list keeps; a longer one is cut, never refused. */
export const MODULE_LIST_ORDER_MAX = 500;
/** Longest id an order entry may carry (cuid and uuid fit comfortably). */
export const MODULE_LIST_ID_MAX = 64;

export interface ModuleListPrefs {
  view: ModuleListView;
  order: string[];
  sortDir: ModuleSortDir;
}

export interface ModuleListPrefsEntry extends ModuleListPrefs {
  /** True when the server holds at least one choice for this list. */
  saved: boolean;
}

export interface ModuleListLayout {
  version: 1;
  lists: Record<ModuleListKey, ModuleListPrefsEntry>;
}

const BASE_DEFAULTS: ModuleListPrefs = {
  view: "cards",
  order: [],
  sortDir: "recentDesc",
};

/** Labs opens on the compact list, the dense reading table (#40). */
const LIST_DEFAULTS: Record<ModuleListKey, ModuleListPrefs> = {
  labs: { ...BASE_DEFAULTS, view: "list" },
  illness: { ...BASE_DEFAULTS },
  vorsorge: { ...BASE_DEFAULTS },
};

export function moduleListDefaults(list: ModuleListKey): ModuleListPrefs {
  const defaults = LIST_DEFAULTS[list];
  return { ...defaults, order: [...defaults.order] };
}

export function isModuleListKey(value: unknown): value is ModuleListKey {
  return (
    typeof value === "string" &&
    (MODULE_LIST_KEYS as readonly string[]).includes(value)
  );
}

export function isModuleListView(value: unknown): value is ModuleListView {
  return (
    typeof value === "string" &&
    (MODULE_LIST_VIEWS as readonly string[]).includes(value)
  );
}

export function isModuleSortDir(value: unknown): value is ModuleSortDir {
  return (
    typeof value === "string" &&
    (MODULE_SORT_DIRS as readonly string[]).includes(value)
  );
}

/** Keep string ids of a sane length, first occurrence wins, capped. */
export function normaliseModuleListOrder(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    if (value.length === 0 || value.length > MODULE_LIST_ID_MAX) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MODULE_LIST_ORDER_MAX) break;
  }
  return out;
}

/**
 * The fields a stored blob explicitly carries for one list, each validated.
 * Unknown or malformed values drop out, so the default fills them on read.
 */
export function storedModuleListChoices(
  raw: unknown,
): Partial<ModuleListPrefs> {
  if (raw === null || raw === undefined || typeof raw !== "object") return {};
  const blob = raw as { view?: unknown; order?: unknown; sortDir?: unknown };
  const order = normaliseModuleListOrder(blob.order);
  return {
    ...(isModuleListView(blob.view) ? { view: blob.view } : {}),
    ...(order !== null ? { order } : {}),
    ...(isModuleSortDir(blob.sortDir) ? { sortDir: blob.sortDir } : {}),
  };
}

/** Every list's stored choices, keyed by list. */
export function storedModuleListLayout(
  raw: unknown,
): Partial<Record<ModuleListKey, Partial<ModuleListPrefs>>> {
  if (raw === null || raw === undefined || typeof raw !== "object") return {};
  const blob = raw as Record<string, unknown>;
  const out: Partial<Record<ModuleListKey, Partial<ModuleListPrefs>>> = {};
  for (const list of MODULE_LIST_KEYS) {
    const choices = storedModuleListChoices(blob[list]);
    if (Object.keys(choices).length > 0) out[list] = choices;
  }
  return out;
}

/**
 * Any malformed, partial or legacy blob collapses onto the defaults field by
 * field, so a GET never fails on a stored row.
 */
export function resolveModuleListLayout(raw: unknown): ModuleListLayout {
  const stored = storedModuleListLayout(raw);
  const lists = {} as Record<ModuleListKey, ModuleListPrefsEntry>;
  for (const list of MODULE_LIST_KEYS) {
    const choices = stored[list];
    lists[list] = {
      ...moduleListDefaults(list),
      ...choices,
      saved: choices !== undefined,
    };
  }
  return { version: 1, lists };
}
