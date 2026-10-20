import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Card } from "../card";

function classes(html: string): string[] {
  return (html.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
}

describe("<Card density>", () => {
  it("ships the default rhythm", () => {
    const c = classes(renderToStaticMarkup(<Card />));
    expect(c).toEqual(
      expect.arrayContaining(["gap-4", "py-4", "md:gap-6", "md:py-6"]),
    );
  });

  it("pins the compact gap on both breakpoints", () => {
    const html = renderToStaticMarkup(<Card density="compact" />);
    const c = classes(html);
    expect(c).toEqual(
      expect.arrayContaining(["gap-2", "py-3", "md:gap-2", "md:py-4"]),
    );
    // The hand-written tier kept the base desktop gap; the prop must not.
    expect(c).not.toContain("md:gap-6");
    expect(c).not.toContain("md:py-6");
    expect(html).toContain('data-density="compact"');
  });
});

describe("compact density is the prop, not a class list", () => {
  it("leaves no hand-written compact tier on a Card", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { walkSourceFiles } =
      await import("@/__tests__/helpers/source-files");
    const src = join(__dirname, "../../..");
    const hits = walkSourceFiles(src, { floor: 2500 })
      .filter((p) => p.endsWith(".tsx") && !p.includes("__tests__/"))
      .filter((p) => !p.startsWith("components/ui/"))
      .filter((p) =>
        /<Card\b[^>]*className=(?:"[^"]*|\{cn\([^)]*)\bgap-2 py-3\b/.test(
          readFileSync(join(src, p), "utf8"),
        ),
      );
    expect(hits).toEqual([]);
    // The prop is where the compact cards went; a walk that finds none of
    // them read the wrong tree.
    const users = walkSourceFiles(src, { floor: 2500 }).filter(
      (p) =>
        p.endsWith(".tsx") &&
        readFileSync(join(src, p), "utf8").includes('density="compact"'),
    );
    expect(users.length).toBeGreaterThanOrEqual(20);
  });
});
