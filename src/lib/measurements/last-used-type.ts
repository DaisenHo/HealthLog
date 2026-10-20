/**
 * v1.30.1 — remember the last manually-saved measurement
 * type so the add form doesn't default to BLOOD_PRESSURE for a daily
 * weight/glucose logger. Client-only convenience persisted in
 * `localStorage`, mirroring the `mood/recent-tags.ts` MRU pattern: it
 * never touches the API, and a cleared/disabled store just degrades
 * to the pre-existing BLOOD_PRESSURE default.
 *
 * A `defaultType` deep link (`?add=<TYPE>`, the Vorsorge card, an
 * Insights empty-state CTA) always wins over this — callers only
 * consult `getLastUsedMeasurementType()` when no explicit default was
 * supplied.
 */

const STORAGE_KEY = "healthlog:measurement:last-used-type";

/**
 * Read the last-saved type, validated against the caller-supplied set
 * of currently selectable form values so a type retired from the
 * catalog (or a corrupt/foreign value) never gets selected silently.
 */
export function getLastUsedMeasurementType(
  validValues: readonly string[],
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && validValues.includes(raw)) return raw;
  } catch {
    /* storage disabled — fall through to no memory */
  }
  return null;
}

/** Record a successfully-saved type as the new "last used" value. */
export function setLastUsedMeasurementType(type: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, type);
  } catch {
    /* storage full / disabled — nothing to remember */
  }
}
