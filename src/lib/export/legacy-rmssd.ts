/** The sources whose HRV migration 0420 refiled from SDNN to RMSSD. */
export const LEGACY_RMSSD_SOURCES: ReadonlySet<string> = new Set([
  "FITBIT",
  "GOOGLE_HEALTH",
]);

/**
 * A Fitbit or Google Health HRV row a file written before migration 0420
 * still files as `HEART_RATE_VARIABILITY` (SDNN). It is RMSSD.
 */
export function isLegacyRmssdRow(row: {
  type: string;
  source?: string | null;
}): boolean {
  return (
    row.type === "HEART_RATE_VARIABILITY" &&
    row.source != null &&
    LEGACY_RMSSD_SOURCES.has(row.source)
  );
}
