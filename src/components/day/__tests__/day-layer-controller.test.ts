import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reportRouterSearch, resetUrlStateForTests } from "@/lib/url-state";

/**
 * The history contract of the day layer, against a small stand-in for the
 * browser's session history:
 *
 *   - opening adds exactly one entry, so Back closes the layer;
 *   - opening another day while one is open swaps it in place;
 *   - stepping to the neighbouring day never adds an entry, however often,
 *     starts from the day in the URL and never passes today;
 *   - closing a day the layer opened goes Back (the next Back leaves the
 *     page); closing a deep link only drops the parameter and stays.
 */

interface Entry {
  state: unknown;
  url: string;
}

function installFakeBrowser(initialUrl: string) {
  const entries: Entry[] = [{ state: null, url: initialUrl }];
  let index = 0;
  const location = {
    get pathname() {
      return new URL(entries[index]!.url, "http://x").pathname;
    },
    get search() {
      return new URL(entries[index]!.url, "http://x").search;
    },
    hash: "",
    get href() {
      return new URL(entries[index]!.url, "http://x").href;
    },
  };
  const history = {
    get state() {
      return entries[index]!.state;
    },
    get length() {
      return entries.length;
    },
    pushState(state: unknown, _unused: string, url: string) {
      entries.splice(index + 1);
      entries.push({ state, url });
      index = entries.length - 1;
    },
    replaceState(state: unknown, _unused: string, url: string) {
      entries[index] = { state, url };
    },
    back() {
      if (index > 0) index -= 1;
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    location,
    history,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
  g.document = { activeElement: null, body: {} };
  // Next adopts each write a render later; the URL-state queue holds the
  // next write until it has. Reading the address bar stands for the router
  // catching up with every write made so far.
  const catchUp = () => {
    for (let i = 0; i < 10; i++) reportRouterSearch(location.search);
  };
  return {
    current: () => {
      catchUp();
      return entries[index]!.url;
    },
    length: () => {
      catchUp();
      return entries.length;
    },
  };
}

let browser: ReturnType<typeof installFakeBrowser>;

const TODAY = "2026-01-10";

beforeEach(() => {
  resetUrlStateForTests();
  browser = installFakeBrowser("/insights/blood-pressure?range=90");
});

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.window;
  delete g.document;
});

describe("day layer history", () => {
  it("opens with one entry and keeps the page's query", async () => {
    const { openDay } = await import("../day-layer-controller");
    openDay("2026-01-03");
    expect(browser.current()).toBe(
      "/insights/blood-pressure?range=90&day=2026-01-03",
    );
    expect(browser.length()).toBe(2);
  });

  it("swaps the day in place when another day opens beside it", async () => {
    const { openDay } = await import("../day-layer-controller");
    openDay("2026-01-03");
    openDay("2026-01-05");
    expect(browser.length()).toBe(2);
    expect(browser.current()).toContain("day=2026-01-05");
  });

  it("steps without adding history entries", async () => {
    const { openDay, stepDay } = await import("../day-layer-controller");
    openDay("2026-01-03");
    stepDay(-1, TODAY);
    stepDay(-1, TODAY);
    stepDay(1, TODAY);
    expect(browser.length()).toBe(2);
    expect(browser.current()).toContain("day=2026-01-02");
  });

  it("steps from the day in the URL, so quick steps in a row all count", async () => {
    // Nothing republishes the open day between these calls, which is what a
    // fast key repeat looks like while the layer is still rendering the
    // previous step. Each step must still move from where the last one went.
    const { openDay, stepDay } = await import("../day-layer-controller");
    openDay("2026-01-03");
    expect(stepDay(1, TODAY)).toBe("2026-01-04");
    expect(stepDay(1, TODAY)).toBe("2026-01-05");
    expect(browser.current()).toContain("day=2026-01-05");
  });

  it("holds a step while the layer still shows another day, then makes it", async () => {
    // The layer publishes the day it shows only once Next has adopted the
    // URL. A step written before that can be put back by Next's own write,
    // so it waits for the layer and goes in one write when it catches up.
    const { openDay, publishOpenDay, stepDay } =
      await import("../day-layer-controller");
    openDay("2026-01-03");
    publishOpenDay("2026-01-03");
    expect(stepDay(-1, TODAY)).toBe("2026-01-02");
    // The layer still shows the 3rd: these two wait.
    expect(stepDay(1, TODAY)).toBeNull();
    expect(stepDay(1, TODAY)).toBeNull();
    expect(browser.current()).toContain("day=2026-01-02");
    publishOpenDay("2026-01-02");
    expect(browser.current()).toContain("day=2026-01-04");
    expect(browser.length()).toBe(2);
    publishOpenDay(null);
  });

  it("never steps past today, however often it is asked", async () => {
    const { openDay, stepDay } = await import("../day-layer-controller");
    openDay("2026-01-09");
    expect(stepDay(1, TODAY)).toBe(TODAY);
    expect(stepDay(1, TODAY)).toBeNull();
    expect(stepDay(1, TODAY)).toBeNull();
    expect(browser.current()).toContain(`day=${TODAY}`);
  });

  it("does nothing while no day is open", async () => {
    const { stepDay } = await import("../day-layer-controller");
    expect(stepDay(-1, TODAY)).toBeNull();
    expect(browser.current()).toBe("/insights/blood-pressure?range=90");
  });

  it("closes a pushed day with Back, landing on the page without it", async () => {
    const { closeDay, openDay, stepDay } =
      await import("../day-layer-controller");
    openDay("2026-01-03");
    stepDay(1, TODAY);
    closeDay();
    expect(browser.current()).toBe("/insights/blood-pressure?range=90");
  });

  it("closes a deep link in place: the parameter goes, the page stays", async () => {
    browser = installFakeBrowser("/?day=2026-01-03");
    const { closeDay, stepDay } = await import("../day-layer-controller");
    stepDay(-1, TODAY);
    expect(browser.current()).toBe("/?day=2026-01-02");
    closeDay();
    expect(browser.current()).toBe("/");
    expect(browser.length()).toBe(1);
  });
});
