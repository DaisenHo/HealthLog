import { describe, expect, it, vi } from "vitest";

import { combinedCap, listPage, parseListQuery } from "../list-query";

describe("listPage", () => {
  it("asks for one row past the limit and reports a cut only when that row exists", async () => {
    const read = vi.fn(async (take: number) =>
      Array.from({ length: Math.min(take, 5) }, (_, i) => i),
    );

    const cut = await listPage(3, read);
    expect(read).toHaveBeenLastCalledWith(4);
    expect(cut.rows).toEqual([0, 1, 2]);
    expect(cut.cap).toEqual({ truncated: true, limit: 3 });

    // Exactly full is complete: five rows, a limit of five.
    const full = await listPage(5, read);
    expect(full.rows).toHaveLength(5);
    expect(full.cap).toEqual({ truncated: false, limit: 5 });

    const short = await listPage(9, read);
    expect(short.rows).toHaveLength(5);
    expect(short.cap.truncated).toBe(false);
  });
});

describe("combinedCap", () => {
  it("is truncated when any list was cut", () => {
    expect(
      combinedCap(
        { truncated: false, limit: 50 },
        { truncated: true, limit: 50 },
      ),
    ).toEqual({ truncated: true, limit: 50 });
    expect(
      combinedCap(
        { truncated: false, limit: 50 },
        { truncated: false, limit: 50 },
      ).truncated,
    ).toBe(false);
  });
});

describe("parseListQuery", () => {
  const options = { defaultLimit: 50, maxLimit: 200, offset: true };

  it("applies the default and reads both fields", () => {
    expect(parseListQuery(new URLSearchParams(), options).data).toEqual({
      limit: 50,
      offset: 0,
    });
    expect(
      parseListQuery(new URLSearchParams("limit=10&offset=20"), options).data,
    ).toEqual({ limit: 10, offset: 20 });
  });

  it("refuses a limit past the ceiling and a negative offset, both at once", () => {
    const parsed = parseListQuery(
      new URLSearchParams("limit=500&offset=-1"),
      options,
    );
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path[0]).sort()).toEqual([
      "limit",
      "offset",
    ]);
  });

  it("ignores offset on a route that does not page", () => {
    expect(
      parseListQuery(new URLSearchParams("offset=20"), {
        defaultLimit: 50,
        maxLimit: 200,
      }).data,
    ).toEqual({ limit: 50, offset: 0 });
  });
});
