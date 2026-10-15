/**
 * Every request a link picker can send must be one its list route accepts.
 *
 * A refused parameter comes back as a 422, and a picker that reads a failed
 * read as an empty list tells the person there is nothing to link. That is how
 * the visit form's condition picker and both document pickers once showed
 * nothing at all. Each builder is checked in every direction, with and without
 * a date, against the very schema its route parses with.
 */
import { describe, expect, it } from "vitest";

import { documentListQuerySchema } from "@/lib/validations/inbound-documents";
import { encounterListQuerySchema } from "@/lib/validations/encounters";
import { illnessEpisodeListQuerySchema } from "@/lib/validations/illness";
import { listLabResultsSchema } from "@/lib/validations/labs";

import {
  documentPickerUrl,
  encounterPickerUrl,
  episodePickerUrl,
  labPickerUrl,
} from "../picker-requests";
import {
  PICKER_PAGE_SIZE,
  nextOffset,
  pickerPivot,
  type PickerPageRequest,
} from "../use-link-picker-pages";

const pivot = pickerPivot("2019-05-10T10:00:00.000Z");

const REQUESTS: PickerPageRequest[] = [
  { direction: "older", pivot, term: "", cursor: null },
  { direction: "older", pivot, term: "", cursor: "200" },
  { direction: "older", pivot: null, term: "", cursor: null },
  { direction: "newer", pivot, term: "", cursor: null },
  { direction: "newer", pivot, term: "", cursor: "100" },
  { direction: "search", pivot: null, term: "ferritin", cursor: null },
  { direction: "search", pivot: null, term: "ferritin", cursor: "100" },
];

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, "http://local").searchParams);
}

describe.each([
  ["labs", labPickerUrl, listLabResultsSchema],
  ["episodes", episodePickerUrl, illnessEpisodeListQuerySchema],
  ["encounters", encounterPickerUrl, encounterListQuerySchema],
])("%s picker", (_name, build, schema) => {
  it.each(REQUESTS)("$direction (cursor $cursor) parses", (request) => {
    const result = schema.safeParse(params(build(request)));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe("documents picker", () => {
  it.each(REQUESTS)("$direction parses", (request) => {
    // The document cursor is a row id, not an offset.
    const url = documentPickerUrl({
      ...request,
      cursor: request.cursor ? "doc-id" : null,
    });
    const result = documentListQuerySchema.safeParse(params(url));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("splits the day-granular window at the pivot's day", () => {
    const older = params(
      documentPickerUrl({ direction: "older", pivot, term: "", cursor: null }),
    );
    const newer = params(
      documentPickerUrl({ direction: "newer", pivot, term: "", cursor: null }),
    );
    expect(older.to).toBe("2019-05-17");
    expect(newer.from).toBe("2019-05-18");
    expect(older.order).toBe("desc");
    expect(newer.order).toBe("asc");
  });
});

describe("the windows around a record's date", () => {
  it("splits a week after the date, at the end of that day", () => {
    expect(pivot).toBe("2019-05-17T23:59:59.999Z");
    expect(pickerPivot(null)).toBeNull();
    expect(pickerPivot("not a date")).toBeNull();
  });

  it("older reads up to the split newest first, newer after it oldest first", () => {
    const older = params(
      labPickerUrl({ direction: "older", pivot, term: "", cursor: null }),
    );
    const newer = params(
      labPickerUrl({ direction: "newer", pivot, term: "", cursor: null }),
    );
    expect(older).toMatchObject({ to: pivot, sortDir: "desc", offset: "0" });
    expect(newer).toMatchObject({
      from: "2019-05-18T00:00:00.000Z",
      sortDir: "asc",
    });
  });

  it("a search ignores the window and sends the term", () => {
    const search = params(
      labPickerUrl({
        direction: "search",
        pivot: null,
        term: "ferritin",
        cursor: null,
      }),
    );
    expect(search.q).toBe("ferritin");
    expect(search.from).toBeUndefined();
    expect(search.to).toBeUndefined();
  });

  it("an offset page that came back full has a next page, a short one has none", () => {
    expect(nextOffset(null, PICKER_PAGE_SIZE)).toBe(String(PICKER_PAGE_SIZE));
    expect(nextOffset("100", PICKER_PAGE_SIZE)).toBe("200");
    expect(nextOffset("100", 3)).toBeNull();
  });
});
