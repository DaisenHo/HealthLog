/**
 * Every Settings address a person ever had keeps working.
 *
 * Settings has been regrouped many times (v1.4 split, v1.17 layout hub,
 * v1.25 Darstellung, v1.44 nine groups), and every bookmark, cross-link in
 * an older notification and docs page still points at one of those shapes.
 * This walks the full list of historical `/settings/*` addresses through the
 * redirects in `next.config.ts` and asserts each one lands on a route that
 * renders: a section slug, an Arrangement sub-page or a module page. It does
 * the same for the anchors a page forwards client-side when a card moved
 * while its page stayed (`settings-anchor-forward.tsx`).
 *
 * A route removed without a redirect, a redirect pointing at a page that no
 * longer exists, or a forward whose target 404s fails here by name.
 */
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { SETTINGS_SECTION_SLUGS } from "@/components/settings/section-slugs";
import { LAYOUT_GROUP_IDS } from "@/components/settings/layout-groups";
import { MODULE_SETTINGS_PAGE_IDS } from "@/components/settings/module-settings-page-ids";
import {
  SETTINGS_ANCHOR_FORWARDS,
  forwardedAnchorTarget,
} from "@/components/settings/settings-anchor-forward";

/** Every Settings path that was ever reachable, newest shapes included. */
const HISTORICAL_SETTINGS_PATHS: readonly string[] = [
  "/settings",
  // Section slugs of every release since the v1.4 split.
  "/settings/account",
  "/settings/security",
  "/settings/access",
  "/settings/modules",
  "/settings/integrations",
  "/settings/sources",
  "/settings/channels",
  "/settings/notifications",
  "/settings/reminders",
  "/settings/layout",
  "/settings/environment",
  "/settings/anamnesis",
  "/settings/score",
  "/settings/thresholds",
  "/settings/ai",
  "/settings/coach",
  "/settings/api",
  "/settings/mcp",
  "/settings/gesundheitsakte",
  "/settings/sharing",
  "/settings/export",
  "/settings/advanced",
  "/settings/privacy",
  "/settings/about",
  // The per-module personalisation slugs before the layout hub.
  "/settings/dashboard",
  "/settings/insights",
  "/settings/medications",
  "/settings/mood",
  "/settings/labs",
  "/settings/illness",
  "/settings/vorsorge",
  // Layout hub sub-pages since v1.25.11.
  "/settings/layout/dashboard",
  "/settings/layout/insights",
  "/settings/layout/medications",
  "/settings/layout/mood",
  "/settings/layout/labs",
  "/settings/layout/illness",
  "/settings/layout/documents",
  "/settings/layout/vorsorge",
];

interface Redirect {
  source: string;
  destination: string;
}

async function settingsRedirects(): Promise<Redirect[]> {
  const all = (await nextConfig.redirects?.()) ?? [];
  return all
    .filter((r) => r.source.startsWith("/settings"))
    .map((r) => ({ source: r.source, destination: r.destination }));
}

/** Follow exact-match redirects until none applies; the hash is dropped. */
function resolve(path: string, redirects: readonly Redirect[]): string {
  let current = path;
  for (let hop = 0; hop < 5; hop += 1) {
    const next = redirects.find((r) => r.source === current);
    if (!next) return current;
    current = next.destination.split("#")[0]!;
  }
  throw new Error(`redirect loop from ${path}`);
}

/** Does a path (no hash) render a Settings page? */
function renders(path: string): boolean {
  if (path === "/settings") return true; // the page redirects to account
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "settings") return false;
  if (parts.length === 2) {
    return (SETTINGS_SECTION_SLUGS as readonly string[]).includes(parts[1]!);
  }
  if (parts.length === 3 && parts[1] === "layout") {
    return LAYOUT_GROUP_IDS.includes(parts[2]!);
  }
  if (parts.length === 3 && parts[1] === "modules") {
    return (MODULE_SETTINGS_PAGE_IDS as readonly string[]).includes(parts[2]!);
  }
  return false;
}

describe("historical Settings addresses", () => {
  it("reads the redirects from next.config.ts (an empty read is a broken matcher)", async () => {
    const redirects = await settingsRedirects();
    expect(redirects.length).toBeGreaterThanOrEqual(10);
  });

  it.each(HISTORICAL_SETTINGS_PATHS)(
    "%s still lands on a page",
    async (path) => {
      const redirects = await settingsRedirects();
      const landed = resolve(path, redirects);
      expect(renders(landed), `${path} → ${landed}`).toBe(true);
    },
  );

  it("every redirect into Settings points at a page that renders", async () => {
    for (const r of await settingsRedirects()) {
      const target = r.destination.split("#")[0]!;
      expect(renders(target), `${r.source} → ${r.destination}`).toBe(true);
    }
  });

  it("every routable section, sub-page and module page is on the list", () => {
    const routable = [
      ...SETTINGS_SECTION_SLUGS.map((s) => `/settings/${s}`),
      ...LAYOUT_GROUP_IDS.map((id) => `/settings/layout/${id}`),
      ...MODULE_SETTINGS_PAGE_IDS.map((id) => `/settings/modules/${id}`),
    ];
    // New routes join the list when they ship, so a later move cannot drop
    // one silently. Module pages are new in v1.44 and are allowed here.
    const listed = new Set(HISTORICAL_SETTINGS_PATHS);
    const unlisted = routable.filter(
      (path) =>
        !listed.has(path) &&
        !path.startsWith("/settings/modules/") &&
        path !== "/settings/preview",
    );
    expect(unlisted).toEqual([]);
  });

  it("keeps the v1.44 moves addressable", async () => {
    const redirects = await settingsRedirects();
    expect(resolve("/settings/layout/mood", redirects)).toBe(
      "/settings/modules/mood",
    );
    expect(resolve("/settings/mood", redirects)).toBe("/settings/modules/mood");
  });
});

describe("anchors forwarded after a card moved", () => {
  const forwards = Object.entries(SETTINGS_ANCHOR_FORWARDS).flatMap(
    ([page, anchors]) =>
      Object.entries(anchors).map(([anchor, target]) => ({
        page,
        anchor,
        target,
      })),
  );

  it("has forwards to check", () => {
    expect(forwards.length).toBeGreaterThanOrEqual(8);
  });

  it.each(forwards)(
    "$page#$anchor forwards to a page that renders",
    ({ page, anchor, target }) => {
      expect(renders(page), page).toBe(true);
      expect(forwardedAnchorTarget(page, `#${anchor}`)).toBe(target);
      expect(renders(target.split("#")[0]!), target).toBe(true);
    },
  );

  it("leaves an anchor that did not move alone", () => {
    expect(forwardedAnchorTarget("/settings/privacy", "#retention")).toBeNull();
    expect(forwardedAnchorTarget("/settings/security", "#sessions")).toBeNull();
    expect(forwardedAnchorTarget("/settings/privacy", "")).toBeNull();
  });
});
