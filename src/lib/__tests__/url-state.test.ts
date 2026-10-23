import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installUrlStateBrowser,
  type UrlStateBrowser,
} from "@/__tests__/helpers/url-state-browser";

import {
  ADOPTION_GRACE_MS,
  currentUrlSearch,
  reportRouterSearch,
  setAllParams,
  writeUrlHref,
  writeUrlState,
} from "../url-state";

/**
 * The URL-state helper's contract: every write starts from the live address
 * (never a rendered copy), at most one write waits for the router at a time,
 * and what queues behind it is applied on top, together, once the router
 * has the first one (or the grace runs out).
 */

let browser: UrlStateBrowser;
afterEach(() => {
  browser.uninstall();
  vi.useRealTimers();
});

describe("writeUrlState", () => {
  it("edits the live parameters and writes one entry", () => {
    browser = installUrlStateBrowser("/documents?q=scan");
    writeUrlState((params) => params.set("encounter", "e1"), {
      mode: "push",
    });
    expect(browser.push).toHaveBeenCalledWith("/documents?q=scan&encounter=e1");
    expect(browser.replace).not.toHaveBeenCalled();
  });

  it("does not write when nothing changes", () => {
    browser = installUrlStateBrowser("/documents?q=scan");
    writeUrlState((params) => params.set("q", "scan"));
    expect(browser.replace).not.toHaveBeenCalled();
  });

  it("holds a second write until the router has the first, then applies both", () => {
    browser = installUrlStateBrowser("/documents?q=scan", {
      autoAdopt: false,
    });
    writeUrlState((params) => params.set("encounter", "e1"), {
      mode: "push",
    });
    writeUrlState((params) => params.set("year", "2025"));
    // Not yet written, but every reader already sees it.
    expect(browser.current()).toBe("/documents?q=scan&encounter=e1");
    expect(currentUrlSearch()).toBe("?q=scan&encounter=e1&year=2025");
    reportRouterSearch("?q=scan&encounter=e1");
    expect(browser.current()).toBe("/documents?q=scan&encounter=e1&year=2025");
  });

  it("never puts the cleared filters back (the vault's ?encounter= case)", () => {
    browser = installUrlStateBrowser("/documents?q=scan&encounter=e1", {
      autoAdopt: false,
    });
    // "Clear filters" empties the query …
    writeUrlState(setAllParams(""), { mode: "push" });
    // … and the debounced search, still holding the rendered filters,
    // writes `q` again. Derived from the live query, it keeps the clear.
    writeUrlState((params) => params.delete("q"), { mode: "replace" });
    reportRouterSearch("");
    expect(browser.current()).toBe("/documents");
    expect(browser.current()).not.toMatch(/encounter=/);
  });

  it("lets the queue go after the grace when no reader reports", () => {
    vi.useFakeTimers();
    browser = installUrlStateBrowser("/timeline", { autoAdopt: false });
    writeUrlState((params) => params.set("zoom", "year"), { mode: "push" });
    writeUrlState((params) => params.set("day", "2026-01-03"));
    expect(browser.current()).toBe("/timeline?zoom=year");
    vi.advanceTimersByTime(ADOPTION_GRACE_MS);
    expect(browser.current()).toBe("/timeline?zoom=year&day=2026-01-03");
  });

  it("coalesces a queued push with a queued replace into one new entry", () => {
    browser = installUrlStateBrowser("/mood", { autoAdopt: false });
    writeUrlState((params) => params.set("mood", "GUT"));
    writeUrlState((params) => params.set("source", "MANUAL"), { mode: "push" });
    writeUrlState((params) => params.set("from", "2026-05-01"));
    reportRouterSearch("?mood=GUT");
    expect(browser.push).toHaveBeenCalledTimes(1);
    expect(browser.current()).toBe(
      "/mood?mood=GUT&source=MANUAL&from=2026-05-01",
    );
  });

  it("does not wait on a write that keeps the router's own entry state", () => {
    browser = installUrlStateBrowser("/coach?settings=data", {
      autoAdopt: false,
    });
    writeUrlState((params) => params.delete("settings"), { state: "keep" });
    writeUrlState((params) => params.set("c", "abc"), { state: "keep" });
    expect(browser.current()).toBe("/coach?c=abc");
  });

  it("writes a whole href through the same queue", () => {
    browser = installUrlStateBrowser("/coach?c=old");
    writeUrlHref("/coach?c=new");
    expect(browser.replace).toHaveBeenCalledWith("/coach?c=new");
  });

  it("waits two frames for a write made while mounting", () => {
    browser = installUrlStateBrowser("/measurements?add=WEIGHT&type=PULSE");
    const raf = vi.fn((callback: (time: number) => void) => {
      callback(0);
      return 0;
    });
    (
      window as unknown as { requestAnimationFrame: typeof raf }
    ).requestAnimationFrame = raf;
    writeUrlState((params) => params.delete("add"), { afterPaint: true });
    expect(raf).toHaveBeenCalledTimes(2);
    expect(browser.current()).toBe("/measurements?type=PULSE");
  });
});
