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
const ctx = { locale: "en", timeZone: "UTC" } as const;

const REQUESTS: PickerPageRequest[] = [
  { direction: "older", pivot, term: "", cursor: null, ...ctx },
  { direction: "older", pivot, term: "", cursor: "200", ...ctx },
  { direction: "older", pivot: null, term: "", cursor: null, ...ctx },
  { direction: "newer", pivot, term: "", cursor: null, ...ctx },
  { direction: "newer", pivot, term: "", cursor: "100", ...ctx },
  { direction: "search", pivot: null, term: "ferritin", cursor: null, ...ctx },
  { direction: "search", pivot: null, term: "ferritin", cursor: "100", ...ctx },
  { direction: "search", pivot: null, term: "2019", cursor: null, ...ctx },
  {
    direction: "search",
    pivot: null,
    term: "March 2019",
    cursor: "100",
    ...ctx,
  },
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
      documentPickerUrl({
        direction: "older",
        pivot,
        term: "",
        cursor: null,
        ...ctx,
      }),
    );
    const newer = params(
      documentPickerUrl({
        direction: "newer",
        pivot,
        term: "",
        cursor: null,
        ...ctx,
      }),
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
      labPickerUrl({
        direction: "older",
        pivot,
        term: "",
        cursor: null,
        ...ctx,
      }),
    );
    const newer = params(
      labPickerUrl({
        direction: "newer",
        pivot,
        term: "",
        cursor: null,
        ...ctx,
      }),
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
        ...ctx,
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

describe("a search term that names a period", () => {
  const search = (
    term: string,
    locale = "en",
    timeZone = "UTC",
  ): PickerPageRequest => ({
    direction: "search",
    pivot: null,
    term,
    cursor: null,
    locale,
    timeZone,
  });

  it.each([
    ["labs", labPickerUrl, "sortDir"],
    ["episodes", episodePickerUrl, "sortDir"],
  ] as const)(
    "%s: a year is the year's instant window, newest first, with no q",
    (_name, build, sortKey) => {
      const sent = params(build(search("2019")));
      expect(sent.q).toBeUndefined();
      expect(sent.from).toBe("2019-01-01T00:00:00.000Z");
      expect(sent.to).toBe("2019-12-31T23:59:59.999Z");
      expect(sent[sortKey]).toBe("desc");
    },
  );

  it("labs: a month in the person's language is that month", () => {
    const sent = params(labPickerUrl(search("März 2019", "de")));
    expect(sent.q).toBeUndefined();
    expect(sent.from).toBe("2019-03-01T00:00:00.000Z");
    expect(sent.to).toBe("2019-03-31T23:59:59.999Z");
  });

  it("the window follows the person's timezone, DST included", () => {
    // Berlin: March 2019 starts at UTC+1 and ends at UTC+2.
    const sent = params(
      episodePickerUrl(search("03.2019", "de", "Europe/Berlin")),
    );
    expect(sent.from).toBe("2019-02-28T23:00:00.000Z");
    expect(sent.to).toBe("2019-03-31T21:59:59.999Z");
  });

  it("documents: the day-granular window is the period's two calendar days", () => {
    const sent = params(documentPickerUrl(search("2019-02")));
    expect(sent.q).toBeUndefined();
    expect(sent.from).toBe("2019-02-01");
    expect(sent.to).toBe("2019-02-28");
    expect(sent.order).toBe("desc");
  });

  it("encounters: the route without text search still gets the period", () => {
    const sent = params(encounterPickerUrl(search("Mar 2019")));
    expect(sent.q).toBeUndefined();
    expect(sent.from).toBe("2019-03-01T00:00:00.000Z");
    expect(sent.to).toBe("2019-03-31T23:59:59.999Z");
  });

  it.each([labPickerUrl, episodePickerUrl, documentPickerUrl])(
    "a plain term stays a text search (%#)",
    (build) => {
      for (const term of ["LDL", "2019abc", "13.2019", "1850"]) {
        const sent = params(build(search(term)));
        expect(sent.q).toBe(term);
        expect(sent.from).toBeUndefined();
        expect(sent.to).toBeUndefined();
      }
    },
  );

  it("a month name is read in the UI locale only", () => {
    // "März" is not an English month, so it stays text.
    expect(params(labPickerUrl(search("März 2019", "en"))).q).toBe("März 2019");
  });

  it("the older and newer windows never read the term", () => {
    const older = params(
      labPickerUrl({ ...search("2019"), direction: "older", pivot }),
    );
    expect(older.to).toBe(pivot);
    expect(older.from).toBeUndefined();
  });
});
