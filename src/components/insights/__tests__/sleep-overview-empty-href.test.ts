/**
 * The sleep-overview empty-state CTA must point at a REAL settings slug.
 * It previously linked to `/settings/devices`, which is not in
 * `SETTINGS_SECTION_SLUGS`, so the dynamic `[section]` route (dynamicParams
 * = false) calls `notFound()` → a hard 404 dead-end. This pins the href to
 * the `integrations` slug (where every device OAuth callback lands) and
 * guards against a regression to any non-existent slug.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isSettingsSectionSlug } from "@/lib/settings/section-slugs";

describe("sleep-overview empty-state CTA href", () => {
  it("links to /settings/integrations (a real settings slug)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/insights/sleep-overview.tsx"),
      "utf8",
    );
    const match = source.match(/href="\/settings\/([a-z-]+)"/);
    expect(
      match,
      "expected a /settings/<slug> href in the sleep overview",
    ).not.toBeNull();
    const slug = match![1];
    expect(slug).toBe("integrations");
    expect(isSettingsSectionSlug(slug)).toBe(true);
  });

  it("never links to the non-existent /settings/devices slug", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/insights/sleep-overview.tsx"),
      "utf8",
    );
    expect(source).not.toContain("/settings/devices");
  });
});
