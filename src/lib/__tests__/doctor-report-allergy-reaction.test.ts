/**
 * An undecryptable allergy reaction must be distinguishable from a
 * genuinely-unset one on a clinician-facing export. The builder used to fail
 * SOFT (→ null, silently omitted) where a sibling dose-change note fails CLOSED,
 * so a reaction that existed but was unreadable rendered as a blank "—" that a
 * clinician reads as "no reaction recorded". `decryptAllergyReaction` now flags
 * the unreadable case so the PDF renders an honest marker.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const decryptMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/coach/bytes-codec", () => ({
  decryptFromBytes: decryptMock,
}));

import { decryptAllergyReaction } from "../doctor-report-data";

afterEach(() => vi.clearAllMocks());

describe("decryptAllergyReaction", () => {
  it("returns null / not-unreadable for a genuinely-unset envelope (null)", () => {
    expect(decryptAllergyReaction(null)).toEqual({
      reaction: null,
      reactionUnreadable: false,
    });
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it("returns null / not-unreadable for an empty envelope", () => {
    expect(decryptAllergyReaction(new Uint8Array(0))).toEqual({
      reaction: null,
      reactionUnreadable: false,
    });
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it("returns the decrypted reaction on success", () => {
    decryptMock.mockReturnValue("hives, swelling");
    expect(decryptAllergyReaction(new Uint8Array([1, 2, 3]))).toEqual({
      reaction: "hives, swelling",
      reactionUnreadable: false,
    });
  });

  it("flags reactionUnreadable when the decrypt throws (key gap / GCM corruption)", () => {
    decryptMock.mockImplementation(() => {
      throw new Error("bad ciphertext");
    });
    // The reaction WAS recorded (non-empty envelope) but cannot be decrypted:
    // reaction stays null, but the honest unreadable flag is raised so the
    // clinician sees a marker, not a silent blank.
    expect(decryptAllergyReaction(new Uint8Array([9, 9, 9]))).toEqual({
      reaction: null,
      reactionUnreadable: true,
    });
  });
});
