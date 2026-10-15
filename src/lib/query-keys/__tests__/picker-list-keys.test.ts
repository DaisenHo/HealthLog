/**
 * One key, one fetch. The visit form's link pickers read labs and illness
 * episodes in their own windows and pages, the Labs list and the illness hook
 * with theirs. Under a shared key whichever read landed first served the
 * other, so the picker could offer 50 episodes or the Labs list could render
 * a picker page as the whole list. The picker reads carry their own keys,
 * still under the domain roots so a lab or episode write evicts them, and
 * each direction, split and term is its own key.
 */
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/lib/query-keys";

const LIST_PARAMS = {
  analyte: undefined,
  panel: undefined,
  from: undefined,
  to: undefined,
  page: 0,
  sortDir: "desc",
} as const;

describe("the link pickers' reads have keys of their own", () => {
  it("labs: differs from the Labs list and sits under the lab root", () => {
    const key = queryKeys.labResultsPicker("older", null, "");
    expect(key).not.toEqual(queryKeys.labResultsList(LIST_PARAMS));
    expect(key.slice(0, 1)).toEqual(queryKeys.labResults());
  });

  it("episodes: differs from the illness list and sits under the illness root", () => {
    const key = queryKeys.illnessEpisodesPicker("older", null, "");
    expect(key).not.toEqual(queryKeys.illnessEpisodes(true));
    expect(key.slice(0, 1)).toEqual(queryKeys.illness());
  });

  it("a different direction, split or term is a different key", () => {
    const base = queryKeys.labResultsPicker("older", "2019-05-17", "");
    expect(base).not.toEqual(
      queryKeys.labResultsPicker("newer", "2019-05-17", ""),
    );
    expect(base).not.toEqual(
      queryKeys.labResultsPicker("older", "2020-01-01", ""),
    );
    expect(queryKeys.labResultsPicker("search", null, "a")).not.toEqual(
      queryKeys.labResultsPicker("search", null, "b"),
    );
  });

  it("documents and visits: under their roots", () => {
    expect(
      queryKeys.inboundDocumentVaultPicker("older", null, "").slice(0, 1),
    ).toEqual(["documents"]);
    expect(queryKeys.encounterPicker("older", null, "").slice(0, 1)).toEqual(
      queryKeys.encounters(),
    );
  });
});
