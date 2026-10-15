/**
 * The stored Dawarich connection: the sealed URL and key on the user row, the
 * sealed preferences beside them, and each day's sealed country code.
 *
 * Preferences are one sealed JSON value (AAD `healthlog/dawarich-prefs/v1`):
 *
 *   homePlaceId            a place id on the instance, the anchor of time away
 *                          from home. An id, never the place itself.
 *   homeCountry            ISO 3166-1 alpha-2 the person chose, or null.
 *   derivedHomeCountry     the most frequent residency country of the last
 *                          365 days, refreshed by every sync; used while
 *                          `homeCountry` is null.
 *   dismissedSuggestionIds travel suggestions the person turned down.
 */
import { Buffer } from "node:buffer";

import { decrypt, decryptBytes, encryptBytes } from "@/lib/crypto";
import {
  DAWARICH_DAY_COUNTRY_AAD,
  DAWARICH_PREFS_AAD,
} from "@/lib/crypto/encrypted-columns";
import { prisma } from "@/lib/db";
import { getEvent } from "@/lib/logging/context";

import type { DawarichConnection } from "./client";

export interface DawarichPrefs {
  homePlaceId: number | null;
  homeCountry: string | null;
  derivedHomeCountry: string | null;
  dismissedSuggestionIds: string[];
}

export const EMPTY_DAWARICH_PREFS: DawarichPrefs = {
  homePlaceId: null,
  homeCountry: null,
  derivedHomeCountry: null,
  dismissedSuggestionIds: [],
};

/** At most this many dismissed suggestions are remembered, newest kept. */
const DISMISSED_LIMIT = 200;

const COUNTRY = /^[A-Z]{2}$/;

function toBytes(sealed: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(sealed.byteLength));
  out.set(sealed);
  return out;
}

export function sealDawarichPrefs(
  prefs: DawarichPrefs,
): Uint8Array<ArrayBuffer> {
  return toBytes(
    encryptBytes(
      Buffer.from(
        JSON.stringify({
          homePlaceId: prefs.homePlaceId,
          homeCountry: prefs.homeCountry,
          derivedHomeCountry: prefs.derivedHomeCountry,
          dismissedSuggestionIds:
            prefs.dismissedSuggestionIds.slice(-DISMISSED_LIMIT),
        }),
        "utf8",
      ),
      DAWARICH_PREFS_AAD,
    ),
  );
}

/**
 * Open the sealed preferences. A value that does not open, or holds an
 * unexpected shape, reads as empty preferences with a warning on the event:
 * losing the home place is recoverable from the settings card, failing every
 * read of the connection is not.
 */
export function openDawarichPrefs(
  sealed: Uint8Array | null | undefined,
): DawarichPrefs {
  if (!sealed) return { ...EMPTY_DAWARICH_PREFS };
  try {
    const raw = JSON.parse(
      decryptBytes(Buffer.from(sealed), DAWARICH_PREFS_AAD).toString("utf8"),
    ) as Record<string, unknown>;
    const country = (value: unknown) =>
      typeof value === "string" && COUNTRY.test(value) ? value : null;
    return {
      homePlaceId:
        typeof raw.homePlaceId === "number" &&
        Number.isInteger(raw.homePlaceId) &&
        raw.homePlaceId > 0
          ? raw.homePlaceId
          : null,
      homeCountry: country(raw.homeCountry),
      derivedHomeCountry: country(raw.derivedHomeCountry),
      dismissedSuggestionIds: Array.isArray(raw.dismissedSuggestionIds)
        ? raw.dismissedSuggestionIds.filter(
            (id): id is string => typeof id === "string" && id.length <= 64,
          )
        : [],
    };
  } catch (error) {
    getEvent()?.addWarning(
      `dawarich prefs did not open: ${error instanceof Error ? error.name : "unknown"}`,
    );
    return { ...EMPTY_DAWARICH_PREFS };
  }
}

/** The home country in force: the chosen one, else the derived one. */
export function effectiveHomeCountry(prefs: DawarichPrefs): string | null {
  return prefs.homeCountry ?? prefs.derivedHomeCountry;
}

export function sealDayCountry(code: string): Uint8Array<ArrayBuffer> {
  return toBytes(
    encryptBytes(Buffer.from(code, "utf8"), DAWARICH_DAY_COUNTRY_AAD),
  );
}

/** A day's country code, or null when the value does not open. */
export function openDayCountry(sealed: Uint8Array | null): string | null {
  if (!sealed) return null;
  try {
    const code = decryptBytes(
      Buffer.from(sealed),
      DAWARICH_DAY_COUNTRY_AAD,
    ).toString("utf8");
    return COUNTRY.test(code) ? code : null;
  } catch {
    getEvent()?.addWarning("dawarich day country did not open");
    return null;
  }
}

export interface StoredDawarich {
  connection: DawarichConnection;
  prefs: DawarichPrefs;
}

/** The account's connection, or null when none is stored. */
export async function loadDawarichConnection(
  userId: string,
): Promise<StoredDawarich | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      dawarichUrlEncrypted: true,
      dawarichApiKeyEncrypted: true,
      dawarichPrefsEncrypted: true,
    },
  });
  if (!row?.dawarichUrlEncrypted || !row.dawarichApiKeyEncrypted) return null;
  return {
    connection: {
      baseUrl: decrypt(row.dawarichUrlEncrypted),
      apiKey: decrypt(row.dawarichApiKeyEncrypted),
    },
    prefs: openDawarichPrefs(row.dawarichPrefsEncrypted),
  };
}

/** Replace the sealed preferences. */
export async function saveDawarichPrefs(
  userId: string,
  prefs: DawarichPrefs,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { dawarichPrefsEncrypted: sealDawarichPrefs(prefs) },
  });
}
