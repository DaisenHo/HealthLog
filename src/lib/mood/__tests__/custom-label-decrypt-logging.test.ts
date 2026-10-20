/**
 * An undecryptable custom mood label fails soft (the caller falls
 * back to the generic i18n label) but must NOT be entirely silent: a swallowed
 * decrypt now emits a wide-event so the loss of a user-renamed tag surfaces.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { decryptMock, addWarningMock } = vi.hoisted(() => ({
  decryptMock: vi.fn(),
  addWarningMock: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: decryptMock,
  encrypt: vi.fn(),
}));
vi.mock("@/lib/logging/context", () => ({
  getEvent: () => ({ addWarning: addWarningMock }),
}));

import { decryptCustomLabel } from "../custom-tags";

beforeEach(() => {
  decryptMock.mockReset();
  addWarningMock.mockReset();
});

describe("decryptCustomLabel", () => {
  it("returns null without logging for a genuinely-unset label", () => {
    expect(decryptCustomLabel(null)).toBeNull();
    expect(addWarningMock).not.toHaveBeenCalled();
  });

  it("returns the decrypted label on success", () => {
    decryptMock.mockReturnValue("Morning walk");
    expect(decryptCustomLabel("cipher")).toBe("Morning walk");
    expect(addWarningMock).not.toHaveBeenCalled();
  });

  it("fails soft to null AND logs a wide-event when the decrypt throws", () => {
    decryptMock.mockImplementation(() => {
      throw new Error("bad key");
    });
    expect(decryptCustomLabel("cipher")).toBeNull();
    expect(addWarningMock).toHaveBeenCalledWith(
      expect.stringContaining("custom-label decrypt failed"),
    );
  });
});
