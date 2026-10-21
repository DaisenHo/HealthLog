import { describe, expect, it } from "vitest";

import { RANKED_TYPES } from "@/lib/analytics/source-rank-sql";

import { PROVENANCE_TYPES, isProvenanceType } from "../ranked-types";

describe("the provenance metric list", () => {
  it("is exactly the set of types the ladder ranks", () => {
    expect([...PROVENANCE_TYPES].sort()).toEqual([...RANKED_TYPES].sort());
  });
  it("answers membership", () => {
    expect(isProvenanceType("ACTIVITY_STEPS")).toBe(true);
    expect(isProvenanceType("BLOOD_GLUCOSE")).toBe(false);
  });
});
