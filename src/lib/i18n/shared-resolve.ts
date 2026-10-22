/**
 * Server-side message-bundle map + re-export of the shared key resolver.
 *
 * v1.4.27 — client and server previously each carried
 * their own private copy of `allMessages` plus a near-identical
 * `resolveKey` helper; pinning both to one import stopped the maps
 * drifting when a locale was added.
 *
 * Since the i18n bundle split, `allMessages` is SERVER-ONLY: the root
 * layout picks the active locale's bundle out of it for the RSC handoff
 * and `getServerTranslator()` resolves against it. Do NOT import this
 * module from client code: it reads the catalogs from disk. Client code
 * uses `./load-locale` (dynamic per-locale imports) and `./resolve-key`
 * instead.
 */
import { locales, type Locale } from "./config";
import { resolveKey } from "./resolve-key";
import { lazyServerCatalogs } from "./server-catalogs";

export { resolveKey };

/**
 * Single source of truth for the per-locale message bundle on the
 * server (layout RSC handoff, server translator, jobs). Each entry is read
 * from `messages/<locale>.json` the first time it is indexed and shared by
 * every bundle in the process (`server-catalogs.ts`), so a process holds the
 * locales its users read, not all of them.
 */
export const allMessages: Record<
  Locale,
  Record<string, unknown>
> = lazyServerCatalogs();

/**
 * Every shipped translation of one key, in `locales` order, deduplicated and
 * with missing entries dropped.
 *
 * This is the primitive a DERIVED match index is built from. A matcher that
 * has to recognise an app-owned label in text a person typed must not
 * transcribe the label into its own source: transcribing fixes the locales
 * shipped on the day it was written and reopens the same hole when a new
 * bundle lands. Reading the bundles means a new locale is matchable the day
 * `messages/<locale>.json` arrives, with no edit in the matcher.
 *
 * Known limit, worth stating where it bites: the values returned are what the
 * bundles carry TODAY, while a matcher applies them to text written in the
 * past. Editing a shipped translation therefore orphans whatever was written
 * under the old wording — the fix for that is a legacy alias at the call site,
 * not a data migration.
 */
export function localisedValues(key: string): string[] {
  const seen = new Set<string>();
  for (const locale of locales) {
    const value = resolveKey(allMessages[locale], key);
    if (value && value.trim()) seen.add(value.trim());
  }
  return [...seen];
}
