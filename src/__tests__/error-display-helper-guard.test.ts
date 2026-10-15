/**
 * Every error display goes through the one helper that shows an error id.
 *
 * A self-hoster reporting a failure needs the id the operator finds it by. The
 * web shows it on a server failure with a copy button, through two doors only:
 *
 *   - toasts: `showErrorToast` (`src/lib/errors/error-toast.tsx`), which adds
 *     the id when its `cause` is a 5xx and is otherwise exactly `toast.error`;
 *   - error boundaries: `ErrorDetails` / `ErrorIdLine`, or `errorIdOf` for the
 *     root boundary that renders without any provider.
 *
 * A raw `toast.error(` anywhere else is a toast that can never carry the id,
 * and a route boundary that skips the helper is a crash screen without it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");
const HELPER = "lib/errors/error-toast.tsx";

/** Whitespace-tolerant: `toast.error(`, `toast .error (`, `toast\n.error(`. */
const RAW_TOAST_ERROR = /\btoast\s*\.\s*error\s*\(/g;
const HELPER_CALL = /\bshowErrorToast\s*\(/g;

/**
 * Route boundaries that deliberately show no error id, with the reason. Each
 * entry is a decision, not a convenience.
 */
const BOUNDARY_EXEMPT: Readonly<Record<string, string>> = {
  // The clinician share view is opened by someone outside the instance, with
  // no account and no way to reach its operator; it shows a retry and nothing
  // a probe could learn from, by design (see the file's header).
  "app/c/error.tsx": "public share view, no operator relationship",
};

const files = walkSourceFiles(SRC, { floor: 2500 }).filter(
  (rel) =>
    !rel.includes("__tests__/") &&
    !/\.test\.tsx?$/.test(rel) &&
    !rel.startsWith("generated/"),
);

function read(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

describe("error display helper guard", () => {
  it("finds the helper's own toast.error, so the matcher works", () => {
    const own = read(HELPER).match(RAW_TOAST_ERROR) ?? [];
    expect(own.length).toBeGreaterThan(0);
  });

  it("allows no toast.error outside the helper", () => {
    const offenders = files
      .filter((rel) => rel !== HELPER)
      .filter((rel) => (read(rel).match(RAW_TOAST_ERROR) ?? []).length > 0)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("routes the app's error toasts through showErrorToast", () => {
    const calls = files.reduce(
      (n, rel) => n + (read(rel).match(HELPER_CALL) ?? []).length,
      0,
    );
    // 200 call sites when the helper landed; a count far below it means the
    // matcher or the walk stopped seeing them.
    expect(calls).toBeGreaterThan(180);
  });

  it("renders every route error boundary through the error id helper", () => {
    const boundaries = files.filter((rel) =>
      /^app\/(.*\/)?(error|global-error)\.tsx$/.test(rel),
    );
    expect(boundaries.length).toBeGreaterThanOrEqual(3);
    const missing = boundaries
      .filter((rel) => !(rel in BOUNDARY_EXEMPT))
      .filter((rel) => {
        const source = read(rel);
        return !(
          /<ErrorDetails\b/.test(source) ||
          /<ErrorIdLine\b/.test(source) ||
          /\berrorIdOf\s*\(/.test(source)
        );
      });
    expect(missing).toEqual([]);
    for (const rel of Object.keys(BOUNDARY_EXEMPT)) {
      expect(boundaries, `${rel} is exempt but no longer exists`).toContain(
        rel,
      );
    }
  });

  it("shows the id in the shared boundary panel", () => {
    const source = read("components/error-details.tsx");
    expect(source).toMatch(/<ErrorIdLine\b/);
    expect(source).toMatch(/\berrorIdOf\s*\(/);
  });
});
