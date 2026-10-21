/**
 * The cached AI insights payload, sealed at rest.
 *
 * The model's last full reading of the account (the daily briefing, the
 * per-domain status text and the recommendations, every one of them a
 * sentence about the person's health) lives in `insightsCachedTextEncrypted`
 * (AES-256-GCM, binary layout, purpose-bound by
 * {@link INSIGHTS_CACHED_TEXT_AAD}). The readable column it replaced in
 * v1.43.7 was dropped in v1.44.0 (migration 0430).
 *
 * Every reader and writer goes through this module, so the column name is
 * spelled here and in the classification tables only
 * (`insights-cached-text-access-guard.test.ts`).
 */
import { Buffer } from "node:buffer";

import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { INSIGHTS_CACHED_TEXT_AAD } from "@/lib/crypto/encrypted-columns";
import { warnAndDrop } from "@/lib/crypto/sealed-or-legacy";

/** The columns a reader selects to open the cache. */
export const INSIGHTS_CACHE_SELECT = {
  insightsCachedTextEncrypted: true,
} as const;

/** The row shape {@link openInsightsCachedText} reads. */
export interface InsightsCacheColumns {
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

/** The `data` fields that store a payload. */
export function insightsCacheWrite(text: string): {
  insightsCachedTextEncrypted: Uint8Array<ArrayBuffer>;
} {
  return { insightsCachedTextEncrypted: sealInsightsCachedText(text) };
}

/** The `data` fields that empty the cache. */
export const INSIGHTS_CACHE_CLEARED = {
  insightsCachedTextEncrypted: null,
} as const;

/** A `where` that finds rows holding a cached payload. */
export const INSIGHTS_CACHE_PRESENT_WHERE = {
  insightsCachedTextEncrypted: { not: null },
} as const;

const dropUndecryptable = warnAndDrop("insights cache did not open");

/**
 * The cached payload as text, or null when there is none.
 *
 * A sealed value that does not open reads as an empty cache with a warning on
 * the event. It is a cache: the next warm overwrites it under the active key,
 * whereas failing the read would take the dashboard down with it.
 */
export function openInsightsCachedText(
  row: InsightsCacheColumns | null | undefined,
): string | null {
  const sealed = row?.insightsCachedTextEncrypted;
  if (!sealed || sealed.byteLength === 0) return null;
  try {
    return decryptBytes(Buffer.from(sealed), INSIGHTS_CACHED_TEXT_AAD).toString(
      "utf8",
    );
  } catch (error) {
    return dropUndecryptable(error);
  }
}
