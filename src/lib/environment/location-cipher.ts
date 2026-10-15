/**
 * The environment module's coarse locations, sealed at rest (v1.42, #615).
 *
 * Three places hold a location: the home on the user row
 * (`homeLocationEncrypted`), each dated location period
 * (`EnvironmentTravelLocation.locationEncrypted`), and each stored day
 * (`EnvironmentContext.locationEncrypted`). Coarse as they are (one decimal,
 * about 11 km), a home city and a dated list of trips are still a movement
 * profile, so each row stores ONE sealed value, the JSON `{ lat, lon, label }`
 * under AES-256-GCM with the associated-data label
 * {@link ENVIRONMENT_LOCATION_AAD}: one decrypt per row, and the three parts
 * can never drift apart.
 *
 * Writers seal through {@link sealLocation}; readers go through
 * {@link readLocation}. A sealed value that does not open reads as no
 * location, with a warning on the request's event. The readable columns the
 * sealed value replaced were dropped in v1.43 (migration 0409), which refuses
 * to run while any of them still held a value.
 *
 * The coordinates are rounded to the privacy floor BEFORE sealing, so the
 * sealed value never carries more precision than the readable column did,
 * and nothing that leaves the host (the weather and air-quality requests) is
 * ever finer than that.
 */
import { Buffer } from "node:buffer";

import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { ENVIRONMENT_LOCATION_AAD } from "@/lib/crypto/encrypted-columns";
import { roundCoarse } from "@/lib/environment/open-meteo";
import { getEvent } from "@/lib/logging/context";

/** A coarse location as the module uses it. */
export interface CoarseLocation {
  lat: number;
  lon: number;
  label: string;
}

/** Seal a location for one of the three `*Encrypted` location columns. */
export function sealLocation(
  location: CoarseLocation,
): Uint8Array<ArrayBuffer> {
  const sealed = encryptBytes(
    Buffer.from(
      JSON.stringify({
        lat: roundCoarse(location.lat),
        lon: roundCoarse(location.lon),
        label: location.label,
      }),
      "utf8",
    ),
    ENVIRONMENT_LOCATION_AAD,
  );
  const out = new Uint8Array(new ArrayBuffer(sealed.byteLength));
  out.set(sealed);
  return out;
}

/**
 * Open a sealed location. Throws on a bad key id, a tampered value, or a
 * payload that is not a location.
 */
export function openLocation(sealed: Uint8Array): CoarseLocation {
  const plain = decryptBytes(Buffer.from(sealed), ENVIRONMENT_LOCATION_AAD);
  const parsed = JSON.parse(plain.toString("utf8")) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as CoarseLocation).lat !== "number" ||
    typeof (parsed as CoarseLocation).lon !== "number" ||
    typeof (parsed as CoarseLocation).label !== "string"
  ) {
    throw new Error("sealed environment location has an unexpected shape");
  }
  const { lat, lon, label } = parsed as CoarseLocation;
  return { lat, lon, label };
}

/**
 * The location a row holds, from its sealed value. Null when the row holds
 * none, and null with a warning when the sealed value does not open.
 */
export function readLocation(
  sealed: Uint8Array | null | undefined,
): CoarseLocation | null {
  if (!sealed || sealed.byteLength === 0) return null;
  try {
    return openLocation(sealed);
  } catch (err) {
    getEvent()?.addWarning(
      `environment location decrypt failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
