import { describe, expect, it } from "vitest";

import { apiListSuccess, capRows, overfetch } from "../list-cap";

describe("list cap", () => {
  it("asks for one row past the limit", () => {
    expect(overfetch(100)).toBe(101);
  });

  it("cuts an over-fetched result back and says it was cut", () => {
    expect(capRows([1, 2, 3], 2)).toEqual({
      rows: [1, 2],
      cap: { truncated: true, limit: 2 },
    });
  });

  it("does not call a list that is exactly full cut", () => {
    expect(capRows([1, 2], 2).cap.truncated).toBe(false);
    expect(capRows([], 2).cap.truncated).toBe(false);
  });

  it("keeps data as it is and puts the cap in meta", async () => {
    const res = apiListSuccess({ events: [1] }, { truncated: true, limit: 1 });
    expect(await res.json()).toEqual({
      data: { events: [1] },
      error: null,
      meta: { truncated: true, limit: 1 },
    });
  });
});
