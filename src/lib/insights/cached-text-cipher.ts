/**
 * The cached AI insights payload, sealed at rest.
 *
 * `User.insightsCachedText` held the model's last full reading of the account
 * in the clear: the daily briefing, the per-domain status text and the
 * recommendations, every one of them a sentence about the person's health.
 * It was the last readable column of that kind on the user row. Since v1.43.7
 * the payload lives in `insightsCachedTextEncrypted` (AES-256-GCM, binary
 * layout, purpose-bound by {@link INSIGHTS_CACHED_TEXT_AAD}), and the free-text
 * encryption backfill seals the rows written before.
 *
 * Every reader and writer goes through this module, which is what keeps the
 * two columns in step. A clear that nulls one column and not the other would
 * leave the briefing behind after a consent withdrawal, so the clearing value
 * is exported here and nowhere else spells the column names
 * (`insights-cached-text-access-guard.test.ts`).
 */
import { Buffer } from "node:buffer";

import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { INSIGHTS_CACHED_TEXT_AAD } from "@/lib/crypto/encrypted-columns";
import { readSealedOrLegacy, warnAndDrop } from "@/lib/crypto/sealed-or-legacy";

/** The columns a reader selects to open the cache. */
export const INSIGHTS_CACHE_SELECT = {
  insightsCachedText: true,
  insightsCachedTextEncrypted: true,
} as const;

/** The row shape {@link openInsightsCachedText} reads. */
export interface InsightsCacheColumns {
  insightsCachedText?: string | null;
  insightsCachedTextEncrypted?: Uint8Array | null;
}

/** Seal one payload. Fail-closed: a missing or malformed key throws. */
export function sealInsightsCachedText(text: string): Uint8Array<ArrayBuffer> {
  const sealed = encryptBytes(
    Buffer.from(text, "utf8"),
    INSIGHTS_CACHED_TEXT_AAD,
  );
  const out = new Uint8Array(new ArrayBuffer(sealed.byteLength));
  out.set(sealed);
  return out;
}

/**
 * The `data` fields that store a payload: the ciphertext, and the legacy
 * readable column nulled in the same write so a row never holds both a new
 * sealed payload and an older readable one.
 */
export function insightsCacheWrite(text: string): {
  insightsCachedTextEncrypted: Uint8Array<ArrayBuffer>;
  insightsCachedText: null;
} {
  return {
    insightsCachedTextEncrypted: sealInsightsCachedText(text),
    insightsCachedText: null,
  };
}

/** The `data` fields that empty the cache. Both columns, always. */
export const INSIGHTS_CACHE_CLEARED = {
  insightsCachedText: null,
  insightsCachedTextEncrypted: null,
} as const;

/** A `where` that finds rows holding a cached payload in either column. */
export const INSIGHTS_CACHE_PRESENT_WHERE = {
  OR: [
    { insightsCachedText: { not: null } },
    { insightsCachedTextEncrypted: { not: null } },
  ],
} as const;

/**
 * The cached payload as text, or null when there is none.
 *
 * The ciphertext is read first, as every sealed column is read
 * (`readSealedOrLegacy`); the readable column only when the row holds no
 * ciphertext. A row holding both can come from a writer of the previous
 * release still running after the upgrade; its readable value may be the
 * newer one, and the free-text backfill seals it over the old ciphertext on
 * its next pass. Until then the reader serves the sealed one: an older
 * briefing for a while, never a readable value preferred over a protected
 * one.
 *
 * A sealed value that does not open reads as an empty cache with a warning on
 * the event. It is a cache: the next warm overwrites it under the active key,
 * whereas failing the read would take the dashboard down with it.
 */
export function openInsightsCachedText(
  row: InsightsCacheColumns | null | undefined,
): string | null {
  if (!row) return null;
  return readSealedOrLegacy({
    sealed: row.insightsCachedTextEncrypted,
    legacy: row.insightsCachedText,
    open: (sealed) =>
      decryptBytes(Buffer.from(sealed), INSIGHTS_CACHED_TEXT_AAD).toString(
        "utf8",
      ),
    onUndecryptable: warnAndDrop("insights cache did not open"),
  });
}
