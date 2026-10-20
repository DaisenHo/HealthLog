import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * v1.4.43 — motion-reduce sweep guard.
 *
 * Every `animate-spin` site in component / app code must also carry
 * `motion-reduce:animate-none` so that motion-sensitive users see a
 * static icon instead of a continuous rotation. The audit found 21
 * sites missing the modifier; this test prevents regressions.
 *
 * Scope: `src/**` excluding test files. The check is textual to avoid
 * rendering every loading state — a CI-cheap guard that catches drift
 * any time a new spinner is added without the modifier.
 */
const ROOT = join(process.cwd(), "src");
const EXCLUDE_DIRS = new Set(["__tests__", "node_modules"]);

function collectTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsxFiles(full, acc);
    } else if (
      entry.endsWith(".tsx") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".test.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

describe("motion-reduce coverage — every animate-spin pairs with motion-reduce:animate-none", () => {
  const files = collectTsxFiles(ROOT);

  it("collects component files to scan", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every animate-spin site declares motion-reduce:animate-none", () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        if (!line.includes("animate-spin")) return;
        // Skip comments and string literals that aren't classNames.
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (!line.includes("motion-reduce:animate-none")) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      violations,
      `The following animate-spin sites are missing motion-reduce:animate-none. ` +
        `Append the modifier so motion-sensitive users see a static icon:\n` +
        violations.join("\n"),
    ).toEqual([]);
  });
});

/**
 * v1.26.0 — indefinite-animation reduced-motion sweep.
 *
 * `animate-pulse` / `animate-bounce` / `animate-ping` are Tailwind's
 * INDEFINITE keyframe utilities: unlike a one-shot entrance, they loop
 * until the element unmounts. Any such site that runs for an unbounded
 * time (a typing indicator, a "listening" mic pulse, a live-status dot)
 * must pair with `motion-reduce:animate-none` so a motion-sensitive user
 * sees a static element instead of a perpetual throb.
 *
 * Allowlisted: load-terminating skeletons. A `<Skeleton>` / chart
 * placeholder animates only while data is in flight and then unmounts, so
 * its pulse is transient rather than perpetual; those files own their own
 * reduced-motion story (and today still carry the modifier anyway). The
 * allowlist is the escape hatch for that one legitimate class of use — an
 * indefinite site elsewhere still has to carry the modifier.
 *
 * The check is textual and skips comment lines, mirroring the
 * `animate-spin` sweep above.
 */
describe("motion-reduce coverage — indefinite pulse/bounce/ping pairs with motion-reduce:animate-none", () => {
  const files = collectTsxFiles(ROOT);

  // Load-terminating skeleton surfaces: their animation is bounded by the
  // data-load lifecycle, so they are exempt from the perpetual-animation
  // rule. Path-suffix matched against the absolute filename.
  const SKELETON_ALLOWLIST = [
    "src/components/ui/skeleton.tsx",
    "src/components/charts/chart-skeleton.tsx",
  ];

  const INDEFINITE_RE = /animate-(pulse|bounce|ping)/;

  it("every indefinite animation site declares motion-reduce:animate-none", () => {
    const violations: string[] = [];
    for (const file of files) {
      const posix = file.replace(/\\/g, "/");
      if (SKELETON_ALLOWLIST.some((f) => posix.includes(f))) continue;
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        if (!INDEFINITE_RE.test(line)) return;
        // Skip comment / JSDoc prose that merely names the utility.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        if (!line.includes("motion-reduce:animate-none")) {
          violations.push(`${file}:${idx + 1}: ${trimmed}`);
        }
      });
    }
    expect(
      violations,
      `The following indefinite animate-pulse/bounce/ping sites are missing ` +
        `motion-reduce:animate-none. Append the modifier so motion-sensitive ` +
        `users see a static element (or allowlist the file if it is a ` +
        `load-terminating skeleton):\n` +
        violations.join("\n"),
    ).toEqual([]);
  });
});

/**
 * v1.11.3 — `.animate-insight-in` reduced-motion guard.
 *
 * Unlike `animate-spin` (a Tailwind utility paired with an inline
 * `motion-reduce:animate-none` per site), `.animate-insight-in` is a custom
 * keyframe utility defined in `globals.css` and applied across five insight
 * surfaces (recommendations-grid, recommendation-card, insight-status-card,
 * hero-strip, arztbericht-hero-card). Guarding it at each call site would be
 * fragile, so the guard lives once in `globals.css`: a
 * `@media (prefers-reduced-motion: reduce)` block collapses the animation to
 * `none`, covering every consumer at once. This test pins that central guard
 * so a future edit cannot drop it and silently re-introduce a 400 ms motion
 * for motion-sensitive users.
 */
describe("motion-reduce coverage — animate-insight-in collapses under prefers-reduced-motion", () => {
  const GLOBALS = join(process.cwd(), "src", "app", "globals.css");
  const css = readFileSync(GLOBALS, "utf8");

  it("globals.css defines the .animate-insight-in utility", () => {
    expect(css).toMatch(/\.animate-insight-in\s*\{[^}]*animation:/);
  });

  it("a prefers-reduced-motion block collapses .animate-insight-in to no motion", () => {
    // Locate the reduced-motion media query, then assert that within its
    // body `.animate-insight-in` is reset to `animation: none`. The check
    // is anchored on the media query so a stray `.animate-insight-in {
    // animation: none }` outside a reduced-motion context cannot satisfy it.
    const mediaStart = css.search(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/,
    );
    expect(
      mediaStart,
      "Expected a `@media (prefers-reduced-motion: reduce)` block in globals.css.",
    ).toBeGreaterThanOrEqual(0);

    // Scan from the media query to the end of the file — every motion the app
    // defers under reduced motion lives in such a block, and `.animate-insight-in`
    // must be one of them.
    const fromMedia = css.slice(mediaStart);
    const guarded = /\.animate-insight-in\s*\{\s*animation:\s*none/.test(
      fromMedia,
    );

    expect(
      guarded,
      "Expected `.animate-insight-in { animation: none }` inside a " +
        "`@media (prefers-reduced-motion: reduce)` block in globals.css. " +
        "Without it the 400 ms entrance keyframe plays for motion-sensitive " +
        "users on every insight card.",
    ).toBe(true);
  });
});
