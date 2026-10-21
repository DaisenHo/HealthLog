import { describe, expect, it } from "vitest";

import {
  CHECKUPS_VIEWS,
  VISITS_PATH,
  parseCheckupsView,
  visitPath,
  visitsPath,
} from "../visit-links";

describe("visit links", () => {
  it("opens one visit on the visits tab, never the bare checkups page", () => {
    expect(visitPath("v1")).toBe("/checkups?visit=v1");
    expect(visitPath("a b&c")).toBe("/checkups?visit=a%20b%26c");
  });

  it("opens the visit itself for one, the visits list for several", () => {
    expect(visitsPath(["v1"])).toBe("/checkups?visit=v1");
    expect(visitsPath(["v1", "v2"])).toBe(VISITS_PATH);
    expect(visitsPath([])).toBe(VISITS_PATH);
    expect(VISITS_PATH).toBe("/checkups?view=visits");
  });

  it("reads exactly the checkups page's tabs from `view`", () => {
    for (const view of CHECKUPS_VIEWS) {
      expect(parseCheckupsView(view)).toBe(view);
    }
    expect(parseCheckupsView("visit")).toBeNull();
    expect(parseCheckupsView("")).toBeNull();
    expect(parseCheckupsView(null)).toBeNull();
    expect(parseCheckupsView(undefined)).toBeNull();
  });
});
