/**
 * The message catalogs on the server: read from disk on first use, one
 * locale at a time, once per process.
 *
 * The catalogs used to be eight static JSON imports. A production build gives
 * every server bundle its own copy of a shared module (route handlers, the
 * RSC/SSR renderer, the instrumentation bundle that runs the worker), so each
 * of them carried the whole eight-locale chunk as a source string and parsed
 * all eight on load: a boot profile of an idle process found 32 parsed
 * catalog objects and two 9.7 MB chunk sources, about a fifth of the live
 * heap, for a process whose users read one or two locales.
 *
 * Now nothing is bundled: a catalog is `messages/<locale>.json` read with
 * `readFileSync` the first time a translator or a matcher asks for that
 * locale, and parked on `globalThis`, so every bundle copy in the process
 * shares one parsed object per locale. The read is synchronous because
 * `t()` is; it happens once per locale per process and takes a few
 * milliseconds.
 *
 * The directory is `messages/` under the working directory: the checkout in
 * development and tests, `/app` in the image, which copies it there.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { locales, type Locale } from "./config";

export type ServerCatalog = Record<string, unknown>;

const KEY = Symbol.for("healthlog.i18n.serverCatalogs");

function cache(): Map<Locale, ServerCatalog> {
  const slot = globalThis as unknown as {
    [KEY]?: Map<Locale, ServerCatalog>;
  };
  slot[KEY] ??= new Map();
  return slot[KEY];
}

function catalogDirectory(): string {
  // Not a bundler input: the catalogs are read at run time, and tracing
  // `process.cwd()` would pull the whole checkout into the output.
  return join(/* turbopackIgnore: true */ process.cwd(), "messages");
}

/** One locale's catalog, read and parsed on first use. */
export function serverCatalog(locale: Locale): ServerCatalog {
  const loaded = cache();
  const hit = loaded.get(locale);
  if (hit) return hit;
  if (!(locales as readonly string[]).includes(locale)) {
    throw new Error(`unknown locale: ${String(locale)}`);
  }
  const parsed = JSON.parse(
    readFileSync(join(catalogDirectory(), `${locale}.json`), "utf8"),
  ) as ServerCatalog;
  loaded.set(locale, parsed);
  return parsed;
}

/** Locales whose catalog this process has read so far (for tests and logs). */
export function loadedServerLocales(): Locale[] {
  return [...cache().keys()];
}

/**
 * A `Record<Locale, catalog>` whose entries load on first read. Indexing one
 * locale loads only that one; iterating every locale (the matchers that
 * accept a word in any language) loads them all, as before. An assignment
 * replaces the entry, which is what the SSR cache in `load-locale.ts` and
 * the test helpers do.
 */
export function lazyServerCatalogs(): Record<Locale, ServerCatalog> {
  const record = {} as Record<Locale, ServerCatalog>;
  for (const locale of locales) {
    Object.defineProperty(record, locale, {
      enumerable: true,
      configurable: true,
      get: () => serverCatalog(locale),
      set: (value: ServerCatalog) => {
        Object.defineProperty(record, locale, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    });
  }
  return record;
}
