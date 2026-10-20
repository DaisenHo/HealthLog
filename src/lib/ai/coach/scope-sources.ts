/**
 * The Coach scope's source values, as plain data.
 *
 * `coachScopeSourceSchema` in `./types` is built from this list. It lives
 * apart so a client surface that only needs the values (the insight pages'
 * metric scope, through `./tools/source-keys`) does not pull Zod into its
 * route's first load.
 */
export const COACH_SCOPE_SOURCES = [
  "bp",
  "weight",
  "pulse",
  "mood",
  "compliance",
  // ── v1.4.23 Apple Health additive ──
  // Optional scope toggles for the new HealthKit metrics. Web-only
  // accounts never carry data for these — `buildCoachSnapshot()` only
  // emits the matching block when Apple-Health rows exist.
  "hrv",
  "sleep",
  "resting_hr",
  "steps",
  "active_energy",
  "flights",
  "distance",
  "vo2_max",
  "body_temp",
  // ── v1.7.0 clustered sources ──
  // Cardiovascular composition / vascular metrics.
  "walking_hr",
  "respiratory_rate",
  "spo2",
  "pulse_wave_velocity",
  "vascular_age",
  // Body composition (mass + ratio metrics beyond plain weight).
  "body_fat",
  "fat_mass",
  "fat_free_mass",
  "muscle_mass",
  "lean_body_mass",
  "bone_mass",
  "total_body_water",
  "bmi",
  "visceral_fat",
  // Metabolic.
  "glucose",
  // Mobility & gait.
  "walking_steadiness",
  "walking_asymmetry",
  "walking_double_support",
  "walking_step_length",
  "walking_speed",
  // Environment / exposure.
  "audio_env",
  "audio_headphone",
  "audio_event",
  "daylight",
  "skin_temp",
  // Workout model (read from the `Workout` table, not `Measurement`).
  "workouts",
] as const;

/**
 * Maximum user-visible length for generated and explicitly renamed
 * conversation titles. Here rather than in the schema module so the rename
 * field reads it without the schema library.
 */
export const COACH_CONVERSATION_TITLE_MAX = 80;
