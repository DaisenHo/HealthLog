/**
 * HealthLog defines no Server Actions.
 *
 * The proxy refuses every request carrying `Next-Action` on the strength of
 * that (`src/proxy.ts`): the only callers that send one are scanners. A module
 * that declares `"use server"` would make the refusal break a real feature, so
 * adding one has to come with revisiting it. This guard is the reminder.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "generated" || name === "__tests__") continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("no Server Actions", () => {
  it('has no module or function that declares "use server"', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    const declaring = files
      .filter((file) =>
        /^\s*["']use server["'];?\s*$/m.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC, file));
    expect(declaring).toEqual([]);
  });
});
