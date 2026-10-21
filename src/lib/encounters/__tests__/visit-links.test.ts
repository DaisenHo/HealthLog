import { describe, expect, it } from "vitest";

import { visitPath } from "../visit-links";

describe("visit links", () => {
  it("opens one visit on the visits tab, never the bare checkups page", () => {
    expect(visitPath("v1")).toBe("/checkups?visit=v1");
    expect(visitPath("a b&c")).toBe("/checkups?visit=a%20b%26c");
  });
});
