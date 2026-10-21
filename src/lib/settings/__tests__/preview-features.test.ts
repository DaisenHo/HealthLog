import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREVIEW_FEATURES,
  resolvePreviewFeatures,
} from "../preview-features";

describe("resolvePreviewFeatures", () => {
  it("is all off by default", () => {
    expect(DEFAULT_PREVIEW_FEATURES).toEqual({ topics: false });
    expect(resolvePreviewFeatures(null)).toEqual({ topics: false });
  });

  it("reads a flag only on an explicit true", () => {
    expect(resolvePreviewFeatures({ topics: true })).toEqual({ topics: true });
    expect(resolvePreviewFeatures({ topics: "true" })).toEqual({
      topics: false,
    });
  });

  it("drops unknown keys", () => {
    expect(resolvePreviewFeatures({ topics: true, retired: true })).toEqual({
      topics: true,
    });
  });
});
