import { describe, it, expect } from "vitest";

import {
  MANAGER_GROUP_ORDER,
  SUB_PAGE_MANAGER_GROUP,
  SUB_PAGE_MANAGER_GROUP_SLUGS,
  SUB_PAGE_SLUGS,
  SUB_PAGE_GROUP,
} from "@/lib/insights/sub-page-metric";

/**
 * v1.15.14 — the "Anpassen" sub-page manager lists EVERY routed
 * sub-page slug grouped by category. These guards pin the total grouping
 * so a future slug can never silently drop out of the manager.
 */
describe("sub-page manager grouping", () => {
  it("assigns every slug to exactly one manager group", () => {
    for (const slug of SUB_PAGE_SLUGS) {
      const group = SUB_PAGE_MANAGER_GROUP[slug];
      expect(group, `slug ${slug} has no manager group`).toBeDefined();
      expect(MANAGER_GROUP_ORDER).toContain(group);
    }
  });

  it("the grouped-slugs map partitions the full slug universe", () => {
    const flattened = MANAGER_GROUP_ORDER.flatMap(
      (group) => SUB_PAGE_MANAGER_GROUP_SLUGS[group],
    );
    // No slug missing.
    expect(new Set(flattened)).toEqual(new Set(SUB_PAGE_SLUGS));
    // No slug counted twice.
    expect(flattened.length).toBe(SUB_PAGE_SLUGS.length);
  });

  it("is a superset of the tab-strip nav grouping (SUB_PAGE_GROUP agrees)", () => {
    for (const slug of SUB_PAGE_SLUGS) {
      const navGroup = SUB_PAGE_GROUP[slug];
      if (navGroup) {
        expect(SUB_PAGE_MANAGER_GROUP[slug]).toBe(navGroup);
      }
    }
  });

  it("covers the three categories the tab strip never collapses", () => {
    expect(SUB_PAGE_MANAGER_GROUP_SLUGS.sleep.length).toBeGreaterThan(0);
    expect(SUB_PAGE_MANAGER_GROUP_SLUGS.mood).toContain("mood");
    expect(SUB_PAGE_MANAGER_GROUP_SLUGS.events).toContain("medications");
  });
});
