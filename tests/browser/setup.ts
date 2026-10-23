/**
 * Setup for the `browser` project (`*.browser.test.tsx`, headless Chromium).
 *
 * - The app stylesheet, compiled by Vite through the project's PostCSS
 *   config, so components lay out and hide as they do in the app.
 * - The EN catalog, the fallback floor of every `t()` chain, loaded through
 *   the production loader. `renderWithApp` loads any other locale it is
 *   asked for.
 * - After every test: the real `fetch` and the page's starting address come
 *   back, so a stub or a URL write never reaches the next test. Rendered
 *   trees are unmounted by `vitest-browser-react` itself.
 */
import "@/app/globals.css";

import { afterEach, beforeAll, beforeEach } from "vitest";

import { loadMessages } from "@/lib/i18n/load-locale";

import { restoreFetch } from "./fetch-stub";
import { rememberAddress, restoreAddress } from "./url";

beforeAll(async () => {
  await loadMessages("en");
});

beforeEach(() => {
  rememberAddress();
});

afterEach(() => {
  restoreFetch();
  restoreAddress();
});
