/**
 * Copy that promises something not yet shipped says so.
 *
 * The workout-route switch is off for new accounts, which is what its detail
 * says rather than "off by default": an account that already held tracks at
 * the upgrade started with it on (migration 0434). (The Topics preview switch
 * this file also held is unlisted until its pages ship, and its copy with it.)
 */
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import de from "../../messages/de.json";

describe("settings copy tense", () => {
  it("says workout routes are off for new accounts", () => {
    expect(en.settings.privacy.workoutRoutes.detail).toMatch(
      /^Off for new accounts\./,
    );
    expect(de.settings.privacy.workoutRoutes.detail).toMatch(
      /^Für neue Konten aus\./,
    );
  });
});
