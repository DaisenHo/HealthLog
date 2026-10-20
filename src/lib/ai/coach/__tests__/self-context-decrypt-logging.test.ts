/**
 * An undecryptable Coach self-context field (allergies /
 * conditions) must NOT vanish silently. It still fails closed per field (never
 * surfaces ciphertext, never throws into prompt assembly), but a swallowed
 * decrypt now emits a wide-event so a key-rotation gap surfaces instead of
 * masquerading as "the user never wrote anything".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { decryptMock, addWarningMock, findUniqueMock } = vi.hoisted(() => ({
  decryptMock: vi.fn(),
  addWarningMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { userHealthProfile: { findUnique: findUniqueMock } },
}));
vi.mock("@/lib/ai/coach/bytes-codec", () => ({
  decryptFromBytes: decryptMock,
  encryptToBytes: vi.fn(),
}));
vi.mock("@/lib/logging/context", () => ({
  getEvent: () => ({ addWarning: addWarningMock }),
}));

import { getSelfContextForUser } from "../about-me";

beforeEach(() => {
  decryptMock.mockReset();
  addWarningMock.mockReset();
  findUniqueMock.mockReset();
});

describe("getSelfContextForUser — undecryptable field", () => {
  it("fails closed to null AND logs a wide-event on a decrypt failure", async () => {
    findUniqueMock.mockResolvedValue({
      aboutMeEncrypted: new Uint8Array([1]),
      conditionsEncrypted: null,
      allergiesEncrypted: new Uint8Array([2]), // safety-relevant, undecryptable
      coachFocusEncrypted: null,
    });
    decryptMock.mockImplementation(() => {
      throw new Error("bad ciphertext");
    });

    const ctx = await getSelfContextForUser("u1");

    // Never surfaces ciphertext; the field is null (fail-closed).
    expect(ctx.aboutMe).toBeNull();
    expect(ctx.allergies).toBeNull();
    // But the swallowed decrypt is now visible — one warning per undecryptable
    // field (aboutMe + allergies here).
    expect(addWarningMock).toHaveBeenCalledTimes(2);
    expect(addWarningMock.mock.calls[0][0]).toContain("self-context");
  });

  it("does not log when the fields are genuinely unset", async () => {
    findUniqueMock.mockResolvedValue({
      aboutMeEncrypted: null,
      conditionsEncrypted: null,
      allergiesEncrypted: null,
      coachFocusEncrypted: null,
    });

    const ctx = await getSelfContextForUser("u1");
    expect(ctx).toEqual({
      aboutMe: null,
      conditions: null,
      allergies: null,
      coachFocus: null,
    });
    expect(addWarningMock).not.toHaveBeenCalled();
  });

  it("logs a wide-event when the DB read itself throws (no silent empty profile)", async () => {
    findUniqueMock.mockRejectedValue(new Error("db down"));

    const ctx = await getSelfContextForUser("u1");
    expect(ctx.allergies).toBeNull();
    expect(addWarningMock).toHaveBeenCalledWith(
      expect.stringContaining("self-context load failed"),
    );
  });
});
