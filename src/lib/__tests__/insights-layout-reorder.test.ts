import { describe, it, expect } from "vitest";
import {
  reorderById,
  rebuildTilesWithReorderedVitals,
} from "@/lib/insights-layout-reorder";

describe("reorderById", () => {
  const rows = [
    { id: "a", order: 0, visible: true },
    { id: "b", order: 1, visible: false },
    { id: "c", order: 2, visible: true },
  ];

  it("moves a row forward and renumbers densely", () => {
    const next = reorderById(rows, "a", "c");
    expect(next.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(next.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it("moves a row backward and renumbers densely", () => {
    const next = reorderById(rows, "c", "a");
    expect(next.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(next.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it("preserves every non-order field on each row", () => {
    const next = reorderById(rows, "a", "b");
    const moved = next.find((r) => r.id === "a");
    expect(moved?.visible).toBe(true);
    const hidden = next.find((r) => r.id === "b");
    expect(hidden?.visible).toBe(false);
  });

  it("is a no-op (but still densely renumbered) when ids match", () => {
    const next = reorderById(rows, "b", "b");
    expect(next.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(next.map((r) => r.order)).toEqual([0, 1, 2]);
  });

  it("returns a densely renumbered copy when an id is missing", () => {
    const sparse = [
      { id: "a", order: 5 },
      { id: "b", order: 9 },
    ];
    const next = reorderById(sparse, "a", "zzz");
    expect(next).toEqual([
      { id: "a", order: 0 },
      { id: "b", order: 1 },
    ]);
  });

  it("does not mutate the input array or its rows", () => {
    const input = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    reorderById(input, "a", "b");
    expect(input).toEqual(snapshot);
  });

  it("sorts an unsorted input by order before reordering", () => {
    const unsorted = [
      { id: "c", order: 2 },
      { id: "a", order: 0 },
      { id: "b", order: 1 },
    ];
    const next = reorderById(unsorted, "a", "c");
    expect(next.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("rebuildTilesWithReorderedVitals", () => {
  // v1.15.11 — the inline edit mode reorders only the Vitals subset; the
  // non-Vitals sub-page strip must keep its relative order. The full list is
  // interleaved: overview (non-vitals), then vitals tiles, then a couple of
  // sub-page slugs (non-vitals).
  const VITALS = new Set(["v1", "v2", "v3"]);
  const isVitals = (id: string) => VITALS.has(id);
  const tiles = [
    { id: "overview", order: 0, visible: true }, // non-vitals
    { id: "v1", order: 1, visible: true },
    { id: "v2", order: 2, visible: false },
    { id: "sub-a", order: 3, visible: true }, // non-vitals
    { id: "v3", order: 4, visible: true },
    { id: "sub-b", order: 5, visible: false }, // non-vitals
  ];

  it("substitutes the Vitals slots in their new relative order", () => {
    // Vitals reordered to v3, v1, v2.
    const next = rebuildTilesWithReorderedVitals(
      tiles,
      ["v3", "v1", "v2"],
      isVitals,
    );
    // Vitals positions (originally slots 1, 2, 4) now carry v3, v1, v2.
    expect(next.map((t) => t.id)).toEqual([
      "overview",
      "v3",
      "v1",
      "sub-a",
      "v2",
      "sub-b",
    ]);
    // Densely renumbered.
    expect(next.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps the non-Vitals tiles in their original relative order", () => {
    const next = rebuildTilesWithReorderedVitals(
      tiles,
      ["v3", "v2", "v1"],
      isVitals,
    );
    const nonVitals = next.filter((t) => !isVitals(t.id)).map((t) => t.id);
    expect(nonVitals).toEqual(["overview", "sub-a", "sub-b"]);
  });

  it("carries each substituted tile's own visible flag (not the slot's)", () => {
    // v2 is hidden; after moving v2 into the first vitals slot it must still be
    // hidden — the flag travels with the tile id, not the position.
    const next = rebuildTilesWithReorderedVitals(
      tiles,
      ["v2", "v1", "v3"],
      isVitals,
    );
    const moved = next.find((t) => t.id === "v2");
    expect(moved?.visible).toBe(false);
    expect(moved?.order).toBe(1);
  });

  it("does not mutate the input", () => {
    const snapshot = JSON.parse(JSON.stringify(tiles));
    rebuildTilesWithReorderedVitals(tiles, ["v3", "v1", "v2"], isVitals);
    expect(tiles).toEqual(snapshot);
  });
});
