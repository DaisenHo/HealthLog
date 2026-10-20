import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));

import { backfillVerdict, walkPages, withPageWalkLedger } from "../page-walk";

describe("walkPages", () => {
  it("reads until a page has no next", async () => {
    const walk = await walkPages<number, string>(
      "test.done",
      10,
      async (cursor) => ({
        items: [`p${cursor ?? 0}`],
        next: (cursor ?? 0) < 2 ? (cursor ?? 0) + 1 : null,
      }),
    );
    expect(walk).toEqual({
      items: ["p0", "p1", "p2"],
      pages: 3,
      truncated: false,
    });
  });

  it("reports a walk that reaches its ceiling with a page pending", async () => {
    const walk = await walkPages<number, number>(
      "test.ceiling",
      4,
      async (cursor) => ({ items: [cursor ?? 0], next: (cursor ?? 0) + 1 }),
    );
    expect(walk.truncated).toBe(true);
    expect(walk.pages).toBe(4);
    expect(walk.items).toEqual([0, 1, 2, 3]);
  });

  it("stops on a cursor it already followed, the first one included", async () => {
    const fetchPage = vi.fn(async () => ({ items: [1], next: 0 }));
    const walk = await walkPages<number, number>(
      "test.repeat",
      50,
      fetchPage,
      0,
    );
    expect(walk.truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe("withPageWalkLedger and backfillVerdict", () => {
  it("collects the truncated walks of a run", async () => {
    const { result, truncated } = await withPageWalkLedger(async () => {
      await walkPages("b.walk", 1, async () => ({ items: [], next: "x" }));
      await walkPages("a.walk", 5, async () => ({ items: [], next: null }));
      return "done";
    });
    expect(result).toBe("done");
    expect(truncated).toEqual(["b.walk"]);
  });

  it("retries a failure, leaves a truncated history incomplete, stamps a clean one", () => {
    expect(backfillVerdict({ failed: true, truncated: ["a"] })).toBe("retry");
    expect(backfillVerdict({ failed: false, truncated: ["a"] })).toBe(
      "incomplete",
    );
    expect(backfillVerdict({ failed: false, truncated: [] })).toBe("complete");
  });
});
