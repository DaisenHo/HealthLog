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

  it("never opens a small nonzero value as zero", () => {
    expect(valueEditSeed(0.004)).toBe("0.004");
    expect(valueEditSeed(0.0123456)).toBe("0.0123");
    expect(valueEditSeed(0.87)).toBe("0.87");
    expect(valueEditSeed(0.123456)).toBe("0.123");
    expect(valueEditSeed(-0.004)).toBe("-0.004");
    expect(valueEditSeed(0.0000004)).toBe("0.0000004");
    for (const v of [0.004, 0.0004, 0.00004, 1e-9]) {
      expect(Number(valueEditSeed(v))).not.toBe(0);
    }
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
