/**
 * Copy that promises something not yet shipped says so.
 *
 * The Topics preview switch exists before its pages do, so its description is
 * in the future tense in every locale's source (English) and in German; and
 * the workout-route switch is off for new accounts, which is what its detail
 * says rather than "off by default": an account that already held tracks at
 * the upgrade started with it on (migration 0434).
 */
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import de from "../../messages/de.json";

describe("settings copy tense", () => {
  it("describes the Topics preview as something it will add", () => {
    expect(en.settings.preview.topics.description).toMatch(/^Will add /);
    expect(de.settings.preview.topics.description).toMatch(/sobald/);
  });

  it("says workout routes are off for new accounts", () => {
    expect(en.settings.privacy.workoutRoutes.detail).toMatch(
      /^Off for new accounts\./,
    );
    expect(de.settings.privacy.workoutRoutes.detail).toMatch(
      /^Für neue Konten aus\./,
    );
  });
});
