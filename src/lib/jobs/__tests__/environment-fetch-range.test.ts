/**
 * The nightly environment window ends on the person's today, not the UTC
 * date: east of UTC the local day begins hours before the UTC one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { resolveRange } from "../environment-fetch";

describe("resolveRange", () => {
  // 20:00 UTC on 1 March is already 2 March in Auckland.
  const now = new Date("2026-03-01T20:00:00.000Z");

  it("ends the lookback on the local today", () => {
    expect(resolveRange({}, "Pacific/Auckland", now)).toEqual({
      startDate: "2026-02-23",
      endDate: "2026-03-02",
    });
    expect(resolveRange({}, "America/Los_Angeles", now)).toEqual({
      startDate: "2026-02-22",
      endDate: "2026-03-01",
    });
  });

  it("keeps an explicit range as given", () => {
    expect(
      resolveRange(
        { startDate: "2025-01-01", endDate: "2025-01-31" },
        "Pacific/Auckland",
        now,
      ),
    ).toEqual({ startDate: "2025-01-01", endDate: "2025-01-31" });
  });
});
