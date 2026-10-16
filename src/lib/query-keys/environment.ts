/**
 * Query keys — environmental-context module (v1.25, W-ENV). The overview
 * (home + travel overrides + stored-day summary) and the geocoding search.
 * Part of the centralized factory; aggregated in `./index.ts`.
 */
export const environmentKeys = {
  /**
   * `environment()` is the root prefix every environment write (set home, add /
   * remove a travel override, trigger a backfill) invalidates through, so the
   * settings surface repaints in lockstep.
   */
  environment: () => ["environment"] as const,
  /** Geocoding search results for a query string (cached per query). */
  environmentGeocode: (query: string) =>
    ["environment", "geocode", query] as const,
  /**
   * v1.43 — trips suggested from Dawarich travel days. Under the root prefix,
   * so adding a trip (which covers a suggestion) refreshes the list too.
   */
  environmentTravelSuggestions: () =>
    ["environment", "travel-suggestions"] as const,
};
