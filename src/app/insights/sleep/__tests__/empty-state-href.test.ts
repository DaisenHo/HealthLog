/**
 * v1.17.0 — the sleep empty-state CTA must point at a REAL settings slug.
 * It previously linked to `/settings/data-sources`, which is not in
 * `SETTINGS_SECTION_SLUGS`, so the dynamic `[section]` route calls
 * `notFound()` → a 404 dead-end. This pins the href to the `integrations`
 * slug and guards against a regression to any non-existent slug.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isSettingsSectionSlug } from "@/lib/settings/section-slugs";

describe("sleep empty-state CTA href", () => {
  it("links to /settings/integrations (a real settings slug)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/insights/sleep/page.tsx"),
      "utf8",
    );
    const match = source.match(/href="\/settings\/([a-z-]+)"/);
    expect(
      match,
      "expected a /settings/<slug> href in the sleep page",
    ).not.toBeNull();
    const slug = match![1];
    expect(slug).toBe("integrations");
    expect(isSettingsSectionSlug(slug)).toBe(true);
  });

  it("never links to the removed /settings/data-sources slug", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/insights/sleep/page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("/settings/data-sources");
  });
});
