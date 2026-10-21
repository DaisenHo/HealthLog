/**
 * Oura workout `activity` → HealthLog canonical `WorkoutSportType`.
 *
 * Oura labels a workout with its own lowercase snake_case vocabulary
 * (`walking`, `cycling`, `strength_training`, `cross_country_skiing`, ...)
 * and publishes no closed list of it. The table below covers the activities
 * the Oura app offers; the bucket choices follow the Polar and Strava tables
 * (paddle sports → rowing, racket sports → tennis, climbing and functional
 * training → crossTraining, mobility work → mindAndBody, snow sports → other),
 * so the same real-world session lands in the same bucket whichever source
 * reported it. Anything unknown lands on `"other"`, the row still persists,
 * and the raw label is kept in `Workout.metadata.ouraActivity`.
 */
import type { WorkoutSportType } from "@/lib/validations/workout";

const OURA_SPORT_TABLE: ReadonlyArray<readonly [string, WorkoutSportType]> = [
  // running
  ["running", "running"],
  ["jogging", "running"],
  ["trail_running", "running"],
  ["treadmill_running", "running"],
  // cycling
  ["cycling", "cycling"],
  ["indoor_cycling", "cycling"],
  ["mountain_biking", "cycling"],
  ["road_cycling", "cycling"],
  ["e_biking", "cycling"],
  ["spinning", "cycling"],
  // walking / hiking
  ["walking", "walking"],
  ["nordic_walking", "walking"],
  ["treadmill_walking", "walking"],
  ["hiking", "hiking"],
  ["backpacking", "hiking"],
  // water
  ["swimming", "swimming"],
  ["open_water_swimming", "swimming"],
  ["rowing", "rowing"],
  ["indoor_rowing", "rowing"],
  ["kayaking", "rowing"],
  ["canoeing", "rowing"],
  ["paddling", "rowing"],
  ["stand_up_paddling", "rowing"],
  // machines
  ["elliptical", "elliptical"],
  ["cross_trainer", "elliptical"],
  ["stair_exercise", "stairClimber"],
  ["stair_climbing", "stairClimber"],
  ["stairs", "stairClimber"],
  // strength / intervals / functional
  ["strength_training", "strength"],
  ["weight_training", "strength"],
  ["weightlifting", "strength"],
  ["core_training", "strength"],
  ["hiit", "hiit"],
  ["high_intensity_interval_training", "hiit"],
  ["circuit_training", "hiit"],
  ["cross_training", "crossTraining"],
  ["crossfit", "crossTraining"],
  ["functional_training", "crossTraining"],
  ["climbing", "crossTraining"],
  ["bouldering", "crossTraining"],
  ["rock_climbing", "crossTraining"],
  ["mixed_cardio", "mixedCardio"],
  ["cardio", "mixedCardio"],
  ["aerobics", "dance"],
  // mind and body
  ["yoga", "yoga"],
  ["hot_yoga", "yoga"],
  ["pilates", "mindAndBody"],
  ["stretching", "mindAndBody"],
  ["mobility", "mindAndBody"],
  ["barre", "mindAndBody"],
  ["tai_chi", "mindAndBody"],
  // dance
  ["dancing", "dance"],
  ["dance", "dance"],
  ["zumba", "dance"],
  // ball and racket sports
  ["golf", "golf"],
  ["tennis", "tennis"],
  ["table_tennis", "tennis"],
  ["squash", "tennis"],
  ["padel", "tennis"],
  ["pickleball", "tennis"],
  ["racquetball", "tennis"],
  ["badminton", "badminton"],
  ["basketball", "basketball"],
  ["soccer", "soccer"],
  ["football", "soccer"],
  // everything else that persists outside a bucket
  ["skiing", "other"],
  ["cross_country_skiing", "other"],
  ["downhill_skiing", "other"],
  ["snowboarding", "other"],
  ["skating", "other"],
  ["ice_skating", "other"],
  ["surfing", "other"],
  ["boxing", "other"],
  ["martial_arts", "other"],
  ["volleyball", "other"],
  ["hockey", "other"],
  ["housework", "other"],
  ["gardening", "other"],
  ["other", "other"],
];

/** Fold case and drop separators, so `Strength Training` meets `strength_training`. */
function normaliseOuraActivity(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const OURA_SPORT_MAP: ReadonlyMap<string, WorkoutSportType> = new Map(
  OURA_SPORT_TABLE.map(([name, canonical]) => [
    normaliseOuraActivity(name),
    canonical,
  ]),
);

/**
 * Resolve an Oura workout's `activity` to a canonical `WorkoutSportType`;
 * `"other"` for an absent, blank or unknown label. Never returns the raw
 * label.
 */
export function mapOuraSportType(
  activity: string | null | undefined,
): WorkoutSportType {
  if (typeof activity !== "string" || activity.trim() === "") return "other";
  return OURA_SPORT_MAP.get(normaliseOuraActivity(activity)) ?? "other";
}
