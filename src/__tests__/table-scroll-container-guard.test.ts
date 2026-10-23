/**
 * A sideways-scrolling table wrapper is a positioned box.
 *
 * Screen-reader text (`sr-only`) is absolutely positioned. Inside a scroll
 * container that is not positioned, its containing block is an ancestor
 * outside the container, so it escapes the container's clipping, and a cell
 * panned past the phone's edge widens the whole page: the admin login
 * overview scrolled sideways at 390 px once its IP button gained screen-reader
 * text. Every `overflow-x-auto` wrapper around a table therefore carries
 * `relative`, which makes it the containing block of what it scrolls.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readSourceText, walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");

/** `file:line` of each table wrapper that scrolls without being positioned. */
function offenders(rel: string, text: string): string[] {
  if (!text.includes("<table") || !text.includes("overflow-x-auto")) return [];
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((line, index) => {
    if (!/"[^"]*\boverflow-x-auto\b[^"]*"/.test(line)) return;
    if (/^\s*(\*|\/\/)/.test(line)) return;
    const window = lines.slice(index, index + 8).join("\n");
    if (window.includes("<table") && !/\brelative\b/.test(line)) {
      out.push(`${rel}:${index + 1}`);
    }
  });
  return out;
}

describe("sideways-scrolling table wrappers", () => {
  const files = walkSourceFiles(SRC, { floor: 1500 }).filter(
    (rel) =>
      rel.endsWith(".tsx") &&
      !rel.includes("__tests__") &&
      !rel.startsWith("generated/"),
  );

  it("reads the wrappers it claims to check", () => {
    const wrappers = files.filter((rel) => {
      const text = readSourceText(join(SRC, rel));
      return text.includes("<table") && text.includes("overflow-x-auto");
    });
    expect(wrappers.length).toBeGreaterThan(8);
  });

  it("are positioned, so what they scroll cannot widen the page", () => {
    const found = files.flatMap((rel) =>
      offenders(rel, readSourceText(join(SRC, rel))),
    );
    expect(found).toEqual([]);
  });

  it("catches the shape it guards against", () => {
    const bad = ['<div className="overflow-x-auto">', "  <table>"].join("\n");
    expect(offenders("x.tsx", bad)).toEqual(["x.tsx:1"]);
    const good = ['<div className="relative overflow-x-auto">', "<table>"].join(
      "\n",
    );
    expect(offenders("x.tsx", good)).toEqual([]);
  });
});
