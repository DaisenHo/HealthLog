/**
 * Prime client-side message catalogs beyond EN for one test file.
 *
 * `vitest.setup.ts` seeds only the EN catalog, because every catalog is
 * several hundred kilobytes and the setup file runs once per test file. A
 * test that renders `I18nProvider` in another locale — usually through the
 * synchronous `renderToStaticMarkup`, which cannot wait for the dynamic
 * import a locale switch would trigger — calls this at module scope:
 *
 *   primeLocales("de");
 *   primeLocales(...locales); // every locale the app ships
 *
 * It registers a file-level `beforeAll` that loads each catalog through the
 * production loader, so the cache holds exactly what a locale switch in the
 * app would put there.
 */
import { beforeAll } from "vitest";
import type { Locale } from "@/lib/i18n/config";
import { loadMessages } from "@/lib/i18n/load-locale";

export function primeLocales(...wanted: readonly Locale[]): void {
  beforeAll(async () => {
    await Promise.all(wanted.map((locale) => loadMessages(locale)));
  });
}
