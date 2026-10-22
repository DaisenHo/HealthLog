/**
 * Unit conversions against their round-trip laws.
 *
 * What a person sees: they type a number in their own unit, it is stored in
 * the canonical one, and the screen shows it back. The number shown must be
 * the number typed, for every value they can type, in every unit the app
 * offers. And a stored value shown in another unit must not wander by more
 * than the display grain.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applyDisplayTransform,
  applyDisplayTransformDelta,
  applyDisplayTransformUnrounded,
  getDisplayTransform,
  getReadingTransform,
  invertDisplayTransform,
  TRANSFORMED_TYPES,
  type UnitPreference,
} from "@/lib/measurements/display-transform";
import {
  convertGlucose,
  mgdlToMmol,
  mmolToMgdl,
  toCanonicalMgdl,
} from "@/lib/glucose";

import { assertProperty } from "../../../../tests/property/fast-check";

const typeArb = fc.constantFrom(...[...TRANSFORMED_TYPES].sort());
const preferenceArb = fc.constantFrom<UnitPreference>("metric", "imperial");
const canonicalArb = fc.double({
  min: -100,
  max: 50_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** How the entry surfaces store a typed value: two decimals, canonical unit. */
function storeTyped(display: number, type: string, pref: UnitPreference) {
  const raw = invertDisplayTransform(display, getDisplayTransform(type, pref));
  return Math.round(raw * 100) / 100;
}

describe("metric and imperial display", () => {
  it("inverts the unrounded transform exactly", () => {
    assertProperty(
      fc.property(typeArb, preferenceArb, canonicalArb, (type, pref, raw) => {
        const t = getDisplayTransform(type, pref);
        const back = invertDisplayTransform(
          applyDisplayTransformUnrounded(raw, t),
          t,
        );
        expect(Math.abs(back - raw)).toBeLessThanOrEqual(
          1e-9 * Math.max(1, Math.abs(raw)),
        );
      }),
      400,
    );
  });

  it("rounds a displayed value to within half a display step", () => {
    assertProperty(
      fc.property(typeArb, preferenceArb, canonicalArb, (type, pref, raw) => {
        const t = getDisplayTransform(type, pref);
        const shown = applyDisplayTransform(raw, t);
        const exact = applyDisplayTransformUnrounded(raw, t);
        const step = 10 ** -t.decimals;
        expect(Math.abs(shown - exact)).toBeLessThanOrEqual(step / 2 + 1e-9);
      }),
      400,
    );
  });

  it("shows back exactly the value a person typed in their own unit", () => {
    assertProperty(
      fc.property(
        typeArb,
        preferenceArb,
        fc.integer({ min: 0, max: 50_000 }),
        (type, pref, steps) => {
          const t = getDisplayTransform(type, pref);
          // A value on the display grain, as a person types it.
          const typed = steps / 10 ** t.decimals;
          const stored = storeTyped(typed, type, pref);
          expect(applyDisplayTransform(stored, t)).toBe(typed);
        },
      ),
      400,
    );
  });

  it("converts a difference by the factor alone, never the offset", () => {
    assertProperty(
      fc.property(
        typeArb,
        preferenceArb,
        canonicalArb,
        canonicalArb,
        (type, pref, a, b) => {
          const t = getDisplayTransform(type, pref);
          const viaValues =
            applyDisplayTransformUnrounded(a, t) -
            applyDisplayTransformUnrounded(b, t);
          const step = 10 ** -t.decimals;
          expect(
            Math.abs(applyDisplayTransformDelta(a - b, t) - viaValues),
          ).toBeLessThanOrEqual(
            step / 2 + 1e-6 * Math.max(1, Math.abs(viaValues)),
          );
        },
      ),
    );
  });
});

describe("blood glucose", () => {
  it("shows back exactly the mmol/L value a person typed", () => {
    assertProperty(
      fc.property(fc.integer({ min: 10, max: 400 }), (tenths) => {
        const typed = tenths / 10;
        const stored = toCanonicalMgdl(typed, "mmol/L");
        expect(Number.isInteger(stored)).toBe(true);
        expect(mgdlToMmol(stored)).toBe(typed);
        expect(convertGlucose(stored, "mmol/L")).toBe(typed);
        expect(mmolToMgdl(typed)).toBe(stored);
      }),
    );
  });

  it("moves a stored mg/dL value by at most 1 through a mmol/L round trip", () => {
    assertProperty(
      fc.property(fc.integer({ min: 18, max: 720 }), (mgdl) => {
        expect(
          Math.abs(mmolToMgdl(mgdlToMmol(mgdl)) - mgdl),
        ).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("prints the same figure through the reading transform as through convertGlucose", () => {
    assertProperty(
      fc.property(fc.integer({ min: 18, max: 720 }), (mgdl) => {
        const t = getReadingTransform("BLOOD_GLUCOSE", {
          system: "metric",
          glucoseUnit: "mmol/L",
        });
        expect(applyDisplayTransform(mgdl, t)).toBe(
          convertGlucose(mgdl, "mmol/L"),
        );
      }),
    );
  });

  it("keeps mg/dL canonical: typing mg/dL stores the whole number typed", () => {
    assertProperty(
      fc.property(fc.integer({ min: 18, max: 720 }), (mgdl) => {
        expect(toCanonicalMgdl(mgdl, "mg/dL")).toBe(mgdl);
        expect(convertGlucose(mgdl, "mg/dL")).toBe(mgdl);
      }),
    );
  });
});
