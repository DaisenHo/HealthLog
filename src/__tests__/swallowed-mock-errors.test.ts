/**
 * The setup files fail a test that logged a caught "missing mock export"
 * error (`tests/support/swallowed-mock-errors.ts`). Pinned in both
 * directions, so the check cannot be a no-op.
 */
import { describe, expect, it } from "vitest";

import { watchSwallowedMockErrors } from "../../tests/support/swallowed-mock-errors";

describe("the swallowed mock-export check", () => {
  it("fails on a caught missing-export error that was only logged", () => {
    const check = watchSwallowedMockErrors();
    console.warn(
      "[import] Rollup recompute failed",
      new Error(
        '[vitest] No "ROLLUP_FOLD_WINDOW_MS" export is defined on the "@/lib/rollups/measurement-rollups" mock. Did you forget to return it from "vi.mock"?',
      ),
    );
    expect(check).toThrow(/ROLLUP_FOLD_WINDOW_MS/);
  });

  it("lets every other log line through", () => {
    const check = watchSwallowedMockErrors();
    console.warn("[import] Rollup recompute failed", new Error("db down"));
    expect(check).not.toThrow();
  });
});
