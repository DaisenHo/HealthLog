/**
 * A workout sport's name in the report's language, shared by the PDF and the
 * clinician view. A sport key the catalogue has no sentence for prints as its
 * own words ("stairClimber" → "stair climber"), never as a raw key.
 */
import { translateOrNull } from "@/lib/i18n/translate-code";

export function reportSportLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  sportType: string,
): string {
  return (
    translateOrNull(t, `insights.workouts.sport.${sportType}`) ??
    sportType
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .toLowerCase()
  );
}
