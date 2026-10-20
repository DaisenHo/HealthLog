import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * v1.4.43 — insights mother-page dynamic-skeleton guards.
 * v1.11.3 — rewritten for the shared `BlockSkeleton` loader.
 *
 * The `next/dynamic` loading placeholders for the below-the-hero blocks
 * used to be bespoke `<div className="… h-[Xrem] animate-pulse …
 * motion-reduce:animate-none" />` snippets with hard-coded guessed
 * heights. Those fixed heights pinned each placeholder taller or shorter
 * than the resolved block, so the page CLS-shifted as each chunk landed.
 *
 * E1 collapses all six loaders onto a single shared `BlockSkeleton` that
 * routes through the `Skeleton` primitive (which carries
 * `motion-reduce:animate-none`) and holds the row open with a `min-h`
 * floor rather than a fixed `h-[Xrem]`. This guard pins the new contract:
 * every loader uses `BlockSkeleton`, none re-introduces a hard-coded
 * fixed height, and the decorative (un-mountable) cards stay `aria-hidden`.
 *
 * The check is intentionally textual — render-mounting the page would haul
 * in TanStack-Query / Auth / I18n scaffolding for a property a substring
 * search already proves.
 */
describe("insights mother-page dynamic-skeleton loaders use the shared BlockSkeleton", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/insights/page-client.tsx"),
    "utf8",
  );

  it("defines the shared BlockSkeleton helper", () => {
    expect(src).toMatch(/function BlockSkeleton\(/);
    // The helper renders the shared Skeleton primitive, which carries
    // motion-reduce:animate-none, so every consumer inherits the guard.
    expect(src).toMatch(/<Skeleton[\s\S]*?rounded-xl/);
  });

  it("every dynamic loader routes through BlockSkeleton with a min-h floor", () => {
    // Each below-the-hero loader pins a `min-h-*` floor (not a guessed
    // fixed `h-[Xrem]`) so the row holds open without fighting the
    // resolved block's true height.
    const loaderMatches = [
      ...src.matchAll(
        /loading:\s*\(\)\s*=>\s*<BlockSkeleton\s+minHeight="(min-h-[\w[\]-]+)"/g,
      ),
    ];
    // Five of the six dynamic blocks declare a skeleton loader
    // (RhythmEventsCard intentionally has none — it un-mounts itself when
    // the user has no such events, with no skeleton-then-empty flash).
    expect(loaderMatches.length).toBeGreaterThanOrEqual(5);
    for (const match of loaderMatches) {
      expect(match[1]).toMatch(/^min-h-/);
    }
  });

  it("the decorative (un-mountable) card loaders stay aria-hidden via the decorative flag", () => {
    // CoincidentDeviationCard + PeriodNarrativeCard can un-mount, so their
    // placeholders must hide from assistive tech.
    const decorativeLoaders = [
      ...src.matchAll(/<BlockSkeleton[^/]*\bdecorative\b/g),
    ];
    expect(decorativeLoaders.length).toBeGreaterThanOrEqual(2);
  });

  it("no loader re-introduces a guessed fixed h-[Xrem] / h-[Xpx] height", () => {
    // The guessed fixed heights were the CLS root cause; the loaders now
    // hold the row open with a `min-h-*` floor instead. A fixed
    // `h-[Xrem]` / `h-[Xpx]` must not creep back onto the dynamic-loader
    // placeholders.
    const dynamicBlock = src.match(
      /const DailyBriefing[\s\S]*?const PeriodNarrativeCard[\s\S]*?\);\n/,
    );
    expect(dynamicBlock).not.toBeNull();
    const block = dynamicBlock?.[0] ?? "";
    expect(block).not.toMatch(/h-\[\d+rem\]/);
    expect(block).not.toMatch(/h-\[\d+px\]/);
    // No bespoke pulsing card div should remain — every placeholder is
    // the shared BlockSkeleton.
    expect(block).not.toMatch(/animate-pulse/);
  });
});
