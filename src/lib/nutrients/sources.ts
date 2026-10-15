/**
 * Where a nutrient day row came from. A closed set enforced here rather than
 * by a database enum (`NutrientIntakeDay.source` is text and part of the key):
 *
 *   - `APPLE_HEALTH`: the day total HealthKit synced (`POST /api/nutrients/batch`);
 *   - `MANUAL`: water entered by hand (`POST /api/nutrients/water`);
 *   - `SUPPLEMENT` (v1.43): the sum of the day's taken supplement doses, from
 *     each medication's composition. Derived and recomputed, never entered.
 */
export const NUTRIENT_SOURCE = {
  APPLE_HEALTH: "APPLE_HEALTH",
  MANUAL: "MANUAL",
  SUPPLEMENT: "SUPPLEMENT",
} as const;

export type NutrientSource =
  (typeof NUTRIENT_SOURCE)[keyof typeof NUTRIENT_SOURCE];

const SOURCES: ReadonlySet<string> = new Set(Object.values(NUTRIENT_SOURCE));

export function isNutrientSource(value: string): value is NutrientSource {
  return SOURCES.has(value);
}
