/**
 * v1.20.0 — every CoachScopeSource must either resolve to a snapshot
 * section key (so get_metric_series can fetch it) or be one of the
 * dedicated-tool sources. A new source added to the scope enum without a key
 * here would otherwise fall through to a fabricated "no data" answer for a
 * metric the user actually has — this guard fails the build first.
 */
import { describe, expect, it } from "vitest";

import { coachScopeSourceSchema } from "@/lib/ai/coach/types";
import {
  COACH_SOURCE_SNAPSHOT_KEY,
  METRIC_SERIES_EXCLUDED_SOURCES,
} from "@/lib/ai/coach/tools/source-keys";

describe("COACH_SOURCE_SNAPSHOT_KEY", () => {
  it("covers every CoachScopeSource (key map or dedicated tool)", () => {
    const uncovered = coachScopeSourceSchema.options.filter(
      (source) =>
        COACH_SOURCE_SNAPSHOT_KEY[source] === undefined &&
        !METRIC_SERIES_EXCLUDED_SOURCES.has(source),
    );
    expect(uncovered).toEqual([]);
  });

  it("never maps an excluded (dedicated-tool) source to a series key", () => {
    for (const source of METRIC_SERIES_EXCLUDED_SOURCES) {
      expect(COACH_SOURCE_SNAPSHOT_KEY[source]).toBeUndefined();
    }
  });
});
