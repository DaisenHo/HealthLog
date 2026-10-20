import { describe, expect, it, vi } from "vitest";

const addWarning = vi.fn();
vi.mock("@/lib/logging/context", () => ({ getEvent: () => ({ addWarning }) }));

import { readSealedOrLegacy, warnAndDrop } from "../sealed-or-legacy";

const sealed = new Uint8Array([1, 2, 3]);
const open = (bytes: Uint8Array) => `opened:${bytes.length}`;
const broken = () => {
  throw new Error("bad tag");
};

describe("readSealedOrLegacy", () => {
  it("reads the ciphertext first, even with a readable value beside it", () => {
    expect(
      readSealedOrLegacy({
        sealed,
        legacy: "readable",
        open,
        onUndecryptable: "throw",
      }),
    ).toBe("opened:3");
  });

  it("reads the readable column only when there is no ciphertext", () => {
    for (const none of [null, undefined, new Uint8Array(0)]) {
      expect(
        readSealedOrLegacy({
          sealed: none,
          legacy: "readable",
          open,
          onUndecryptable: "throw",
        }),
      ).toBe("readable");
    }
    expect(
      readSealedOrLegacy({
        sealed: null,
        legacy: null,
        open,
        onUndecryptable: "throw",
      }),
    ).toBeNull();
  });

  it("throws on a ciphertext that does not open when told to", () => {
    expect(() =>
      readSealedOrLegacy({
        sealed,
        legacy: "readable",
        open: broken,
        onUndecryptable: "throw",
      }),
    ).toThrow("bad tag");
  });

  it("drops with a warning, never falling back to the readable value", () => {
    expect(
      readSealedOrLegacy({
        sealed,
        legacy: "readable",
        open: broken,
        onUndecryptable: warnAndDrop("thing did not open"),
      }),
    ).toBeNull();
    expect(addWarning).toHaveBeenCalledWith("thing did not open: bad tag");
  });
});
