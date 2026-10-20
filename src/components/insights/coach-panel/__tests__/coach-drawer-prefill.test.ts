import { describe, expect, it } from "vitest";

import { nextResettableValue } from "../coach-drawer";

/**
 * v1.4.23 — drawer prefill is now a fully-controlled prop.
 *
 * The v1.4.20 implementation reset the composer by mounting the
 * `<CoachDrawer>` with `key={prefill}`. That weaponised React's
 * key-reset to flush internal state every prefill change — Sr-HIGH-4
 * flagged it as a smell because the next refactor that touches the
 * drawer's mount point will silently lose the reset semantics.
 *
 * The fix is the in-render-update pattern documented at
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes:
 * track the last controlled value via `useRef`, and call `setState`
 * during render when the controlled value differs. `nextResettableValue`
 * pins the comparison contract here so a future Object.is rewrite
 * (e.g., shallow-compare migration) can't silently regress.
 */
describe("nextResettableValue (Coach drawer prefill controller)", () => {
  it("reports no reset when the controlled value is unchanged", () => {
    expect(nextResettableValue("How is my BP?", "How is my BP?")).toEqual({
      reset: false,
    });
  });

  it("reports a reset with the next value when the controlled prop changes", () => {
    expect(
      nextResettableValue<string | null>("How is my BP?", "Mood last week?"),
    ).toEqual({ reset: true, value: "Mood last week?" });
  });

  it("treats null and an empty string as different controlled values", () => {
    expect(nextResettableValue<string | null>(null, "")).toEqual({
      reset: true,
      value: "",
    });
    expect(nextResettableValue<string | null>("", null)).toEqual({
      reset: true,
      value: null,
    });
  });

  it("treats a transition from a non-null prefill back to null as a reset", () => {
    // The parent surface clears the prefill back to null after the
    // user clicks a non-suggestion entry point. The composer must
    // empty itself in that transition; otherwise the previous chip's
    // text lingers across drawer opens.
    expect(
      nextResettableValue<string | null>("Why was BP higher Monday?", null),
    ).toEqual({ reset: true, value: null });
  });

  it("uses Object.is, so NaN-to-NaN does not trigger a reset", () => {
    // Defence-in-depth — Object.is(NaN, NaN) is true, unlike ===.
    // The drawer would otherwise reset on every render if the parent
    // happened to pass NaN as a string-coerced default.
    expect(nextResettableValue<number>(Number.NaN, Number.NaN)).toEqual({
      reset: false,
    });
  });
});
