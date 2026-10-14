import { describe, expect, it } from "vitest";

import { resolveValueForUpdate, valueEditSeed } from "../value-update";

describe("valueEditSeed", () => {
  it("opens a converted reading at display precision, not its stored tail", () => {
    // 5.6 mmol/L of glucose, stored in mg/dL.
    expect(valueEditSeed(100.90191999999999)).toBe("100.9");
  });

  it("keeps whole numbers bare and at most two decimals", () => {
    expect(valueEditSeed(110)).toBe("110");
    expect(valueEditSeed(4.567)).toBe("4.57");
  });
});

describe("resolveValueForUpdate", () => {
  it("leaves an untouched value out of the update", () => {
    expect(
      resolveValueForUpdate({
        seed: "100.9",
        editorValue: "100.9",
        parsed: 100.9,
      }),
    ).toBeUndefined();
  });

  it("sends a changed value", () => {
    expect(
      resolveValueForUpdate({
        seed: "100.9",
        editorValue: "101,5",
        parsed: 101.5,
      }),
    ).toBe(101.5);
  });

  it("sends a value typed back to the same number in another spelling", () => {
    // "100,9" is a deliberate re-entry; the stored tail goes, as for any edit.
    expect(
      resolveValueForUpdate({
        seed: "100.9",
        editorValue: "100,9",
        parsed: 100.9,
      }),
    ).toBe(100.9);
  });
});
