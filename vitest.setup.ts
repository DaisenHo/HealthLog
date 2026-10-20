/**
 * Unit-test setup.
 *
 * Seed the client-side locale cache with the EN bundle. In production
 * only the active locale reaches the client (boot script, then dynamic
 * import on switch — see `src/lib/i18n/load-locale.ts`). Tests mount
 * `I18nProvider` standalone — often with `renderToStaticMarkup`, which
 * is synchronous and cannot await a dynamic import — so EN, the fallback
 * floor of the t() chain, is primed up front.
 *
 * Only EN. Every catalog is several hundred kilobytes and this file runs
 * once per test file, so priming all of them made setup the largest share
 * of a unit run. A test that renders another locale primes it itself:
 *
 *   import deMessages from "../../../messages/de.json";
 *   primeMessages("de", deMessages);
 *
 * Server-side translation (`getServerTranslator`, `shared-resolve`) holds
 * every catalog on its own and needs no priming.
 */
import { afterEach } from "vitest";
import { settleBackgroundTasks } from "@/lib/logging/background-tasks";
import { primeMessages } from "@/lib/i18n/load-locale";
import enMessages from "./messages/en.json";

primeMessages("en", enMessages);

/**
 * Leave no background work in flight when a test ends.
 *
 * Several paths start a promise, return without awaiting it, and log on the
 * detached handle so the failure is not swallowed. Vitest forwards every
 * console write to the main thread as an `onUserConsoleLog` RPC call and
 * rejects whatever is still pending on that channel while it tears a test file
 * down, so a write that lands in that window fails the whole run with
 * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`
 * — blamed on the file the worker was tearing down, which is not the test that
 * started the work and need not log anything of its own. Awaiting the
 * registered tasks here removes the precondition instead of muting the
 * console, which would have thrown away a real signal and left the
 * non-determinism in place. See `src/lib/logging/background-tasks.ts`.
 */
afterEach(async () => {
  await settleBackgroundTasks();
});
