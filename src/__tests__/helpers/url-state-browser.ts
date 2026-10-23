/**
 * A stand-in browser for code that writes through `@/lib/url-state`: a
 * location, a session history that records every write, and the event
 * plumbing the helper dispatches on. The router "adopts" each write on the
 * next microtask, as Next does a render later, so a test that awaits between
 * writes sees them land one after another.
 */
import { vi } from "vitest";

import { reportRouterSearch, resetUrlStateForTests } from "@/lib/url-state";

export interface UrlStateBrowser {
  /** `pushState` hrefs, in order. */
  push: ReturnType<typeof vi.fn>;
  /** `replaceState` hrefs, in order. */
  replace: ReturnType<typeof vi.fn>;
  current: () => string;
  uninstall: () => void;
}

export function installUrlStateBrowser(
  initialUrl: string,
  { autoAdopt = true }: { autoAdopt?: boolean } = {},
): UrlStateBrowser {
  resetUrlStateForTests();
  const push = vi.fn();
  const replace = vi.fn();
  let url = initialUrl;
  let state: unknown = null;
  const parsed = () => new URL(url, "http://localhost");
  const location = {
    get pathname() {
      return parsed().pathname;
    },
    get search() {
      return parsed().search;
    },
    get hash() {
      return parsed().hash;
    },
    get href() {
      return parsed().href;
    },
  };
  const adopt = () => {
    if (autoAdopt) queueMicrotask(() => reportRouterSearch(location.search));
  };
  const history = {
    get state() {
      return state;
    },
    pushState(next: unknown, _unused: string, href: string) {
      url = href;
      state = next;
      push(href);
      adopt();
    },
    replaceState(next: unknown, _unused: string, href: string) {
      url = href;
      state = next;
      replace(href);
      adopt();
    },
    back() {},
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const previous = g.window;
  g.window = {
    location,
    history,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    requestAnimationFrame(callback: (time: number) => void) {
      callback(0);
      return 0;
    },
    cancelAnimationFrame() {},
  };
  return {
    push,
    replace,
    current: () => url,
    uninstall: () => {
      resetUrlStateForTests();
      if (previous === undefined) delete g.window;
      else g.window = previous;
    },
  };
}
