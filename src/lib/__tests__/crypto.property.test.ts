/**
 * Encryption at rest against its laws, on random plaintexts, key maps and
 * chunkings.
 *
 * The hand-written cases pin each refusal once; these say it for every
 * input: whatever is sealed opens to the same bytes under the key it names,
 * nothing that was tampered with opens at all, a rotation moves the key id
 * and nothing else, and the streamed codec does not care how the plaintext
 * was cut into chunks.
 */
import { Buffer } from "node:buffer";

import fc from "fast-check";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCryptoCacheForTests,
  createStreamEncryptor,
  decrypt,
  decryptBytes,
  decryptStream,
  encrypt,
  encryptBytes,
  encryptUnderKeyId,
  extractKeyId,
  extractKeyIdFromBytes,
  extractStreamKeyId,
  reencryptBytesToActive,
  reencryptToActive,
} from "../crypto";

import { assertProperty } from "../../../tests/property/fast-check";

const KEYS = {
  v1: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  v2: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  k2026_b: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
} as const;
type KeyId = keyof typeof KEYS;
const keyIdArb = fc.constantFrom<KeyId>("v1", "v2", "k2026_b");

function useKeys(active: KeyId): void {
  vi.stubEnv("ENCRYPTION_KEYS", JSON.stringify(KEYS));
  vi.stubEnv("ENCRYPTION_ACTIVE_KEY_ID", active);
  vi.stubEnv("ENCRYPTION_KEY", "");
  _resetCryptoCacheForTests();
}

beforeEach(() => useKeys("v2"));
afterAll(() => {
  vi.unstubAllEnvs();
  _resetCryptoCacheForTests();
});

const textArb = fc.string({ unit: "grapheme", maxLength: 300 });
const bytesArb = fc.uint8Array({ maxLength: 2_000 }).map((a) => Buffer.from(a));
const aadArb = fc.option(fc.string({ maxLength: 40 }), { nil: undefined });

describe("string codec", () => {
  it("opens what it sealed, under the active key it names", () => {
    assertProperty(
      fc.property(keyIdArb, textArb, (active, text) => {
        useKeys(active);
        const sealed = encrypt(text);
        expect(extractKeyId(sealed)).toBe(active);
        expect(decrypt(sealed)).toBe(text);
      }),
    );
  });

  it("never seals the same text the same way twice", () => {
    assertProperty(
      fc.property(textArb, (text) => {
        expect(encrypt(text)).not.toBe(encrypt(text));
      }),
    );
  });

  it("opens a value sealed under any configured key, whichever key is active", () => {
    assertProperty(
      fc.property(keyIdArb, keyIdArb, textArb, (sealer, active, text) => {
        useKeys(active);
        const sealed = encryptUnderKeyId(text, sealer);
        expect(decrypt(sealed)).toBe(text);
        const rotated = reencryptToActive(sealed);
        expect(extractKeyId(rotated)).toBe(active);
        expect(decrypt(rotated)).toBe(text);
      }),
    );
  });

  it("refuses a sealed value with any one character of its payload changed", () => {
    assertProperty(
      fc.property(textArb, fc.nat(), fc.nat(), (text, at, pick) => {
        const sealed = encrypt(text);
        const dot = sealed.indexOf(".");
        // A payload position, leaving the key id and the base64 padding alone.
        const body = sealed.slice(dot + 1).replace(/=+$/, "");
        const index = dot + 1 + (at % body.length);
        const alphabet =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const original = sealed[index];
        const replacement = alphabet.replace(original, "")[pick % 63];
        const tampered =
          sealed.slice(0, index) + replacement + sealed.slice(index + 1);
        // A change confined to the unused low bits of the final base64
        // character decodes to the same bytes; anything else must not open.
        const sameBytes = Buffer.from(tampered.slice(dot + 1), "base64").equals(
          Buffer.from(sealed.slice(dot + 1), "base64"),
        );
        if (sameBytes) return;
        expect(() => decrypt(tampered)).toThrow();
      }),
      300,
    );
  });
});

describe("binary codec", () => {
  it("opens what it sealed, with the same purpose label, under the key it names", () => {
    assertProperty(
      fc.property(keyIdArb, bytesArb, aadArb, (active, bytes, aad) => {
        useKeys(active);
        const sealed = encryptBytes(bytes, aad);
        expect(extractKeyIdFromBytes(sealed)).toBe(active);
        expect(decryptBytes(sealed, aad).equals(bytes)).toBe(true);
      }),
    );
  });

  it("refuses a different purpose label", () => {
    assertProperty(
      fc.property(
        bytesArb,
        fc.string({ maxLength: 20 }),
        fc.string({ maxLength: 20 }),
        (bytes, a, b) => {
          fc.pre(a !== b);
          const sealed = encryptBytes(bytes, a);
          expect(() => decryptBytes(sealed, b)).toThrow();
        },
      ),
    );
  });

  it("never opens a payload with a flipped bit to anything but the original bytes", () => {
    assertProperty(
      fc.property(
        bytesArb,
        aadArb,
        fc.nat(),
        fc.integer({ min: 0, max: 7 }),
        (bytes, aad, at, bit) => {
          const sealed = encryptBytes(bytes, aad);
          const flipped = Buffer.from(sealed);
          const index = at % flipped.byteLength;
          flipped[index] ^= 1 << bit;
          // The ciphertext, IV and tag are authenticated, so a flip there
          // throws. The key-id header is not: it only selects the key, and a
          // flip of a key-id byte's top bit decodes to the same ASCII id.
          // Either way nothing but the sealed bytes can come out.
          let opened: Buffer;
          try {
            opened = decryptBytes(flipped, aad);
          } catch {
            return;
          }
          expect(index).toBeLessThan(2 + flipped[1]);
          expect(opened.equals(bytes)).toBe(true);
        },
      ),
      300,
    );
  });

  it("rotates to the active key without touching the bytes", () => {
    assertProperty(
      fc.property(
        keyIdArb,
        keyIdArb,
        bytesArb,
        aadArb,
        (from, to, bytes, aad) => {
          useKeys(from);
          const sealed = encryptBytes(bytes, aad);
          useKeys(to);
          const rotated = reencryptBytesToActive(sealed, aad);
          expect(extractKeyIdFromBytes(rotated)).toBe(to);
          expect(decryptBytes(rotated, aad).equals(bytes)).toBe(true);
        },
      ),
    );
  });
});

describe("streamed codec", () => {
  it("does not care how the plaintext was cut into chunks", () => {
    assertProperty(
      fc.property(
        keyIdArb,
        fc.array(fc.uint8Array({ maxLength: 400 }), { maxLength: 12 }),
        (active, chunks) => {
          useKeys(active);
          const encryptor = createStreamEncryptor();
          let stored = encryptor.header;
          for (const chunk of chunks)
            stored += encryptor.update(Buffer.from(chunk));
          stored += encryptor.final();
          expect(extractStreamKeyId(stored)).toBe(active);
          const expected = Buffer.concat(chunks.map((c) => Buffer.from(c)));
          expect(decryptStream(stored).equals(expected)).toBe(true);
        },
      ),
    );
  });

  it("refuses a streamed value cut short", () => {
    assertProperty(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 400 }),
        fc.integer({ min: 4, max: 40 }),
        (bytes, cut) => {
          const encryptor = createStreamEncryptor();
          const stored =
            encryptor.header +
            encryptor.update(Buffer.from(bytes)) +
            encryptor.final();
          const truncated = stored.slice(0, stored.length - cut);
          expect(() => decryptStream(truncated)).toThrow();
        },
      ),
    );
  });
});
