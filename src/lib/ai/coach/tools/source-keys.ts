/**
 * v1.20.0 (F1) — CoachScopeSource → snapshot section key map.
 *
 * `get_metric_series` fetches a single metric by re-running the snapshot
 * builder scoped to that one source, then reads the matching section out of the
 * structured `CoachSnapshotResult.sections`. The builder names each section by
 * a camelCase key (e.g. `heartRateVariability`); this map mirrors the
 * `valueBlocks` table in `snapshot.ts` plus the three core clinical blocks
 * (bloodPressure / weight / pulse) and the mood block.
 *
 * `glucose` and `workouts` are intentionally absent: they have dedicated tools
 * / branches (glucose carries the clinical panel; workouts is deferred). A
 * `get_metric_series` call for one of them resolves to `null` here and the
 * executor returns `{ present: false }` with a pointer to the right tool.
 *
 * The `source-keys.test.ts` guard asserts every `coachScopeSourceSchema` value
 * either resolves here or is explicitly one of the dedicated-tool sources, so a
 * future source addition cannot silently fall through to a fabricated answer.
 */
import { COACH_SCOPE_SOURCES } from "@/lib/ai/coach/scope-sources";
import type { CoachScopeSource } from "@/lib/ai/coach/types";

/** Sources that `get_metric_series` does NOT serve (they have own tools). */
export const METRIC_SERIES_EXCLUDED_SOURCES: ReadonlySet<CoachScopeSource> =
  new Set<CoachScopeSource>(["glucose", "workouts", "compliance"]);

/** source → the snapshot section key its single-metric block lands under. */
export const COACH_SOURCE_SNAPSHOT_KEY: Readonly<
  Partial<Record<CoachScopeSource, string>>
> = {
  // ── core clinical ──
  bp: "bloodPressure",
  weight: "weight",
  pulse: "pulse",
  mood: "mood",
  // ── cardio ──
  hrv: "heartRateVariability",
  resting_hr: "restingHeartRate",
  walking_hr: "walkingHeartRateAverage",
  respiratory_rate: "respiratoryRate",
  spo2: "oxygenSaturation",
  pulse_wave_velocity: "pulseWaveVelocity",
  vascular_age: "vascularAge",
  // ── body composition ──
  body_fat: "bodyFat",
  fat_mass: "fatMass",
  fat_free_mass: "fatFreeMass",
  muscle_mass: "muscleMass",
  lean_body_mass: "leanBodyMass",
  bone_mass: "boneMass",
  total_body_water: "totalBodyWater",
  bmi: "bodyMassIndex",
  visceral_fat: "visceralFat",
  // ── activity ──
  steps: "steps",
  active_energy: "activeEnergy",
  flights: "flightsClimbed",
  distance: "walkingRunningDistance",
  vo2_max: "vo2Max",
  // ── mobility & gait ──
  walking_steadiness: "walkingSteadiness",
  walking_asymmetry: "walkingAsymmetry",
  walking_double_support: "walkingDoubleSupport",
  walking_step_length: "walkingStepLength",
  walking_speed: "walkingSpeed",
  // ── environment / exposure ──
  audio_env: "audioExposureEnvironment",
  audio_headphone: "audioExposureHeadphone",
  audio_event: "audioExposureEvent",
  daylight: "timeInDaylight",
  skin_temp: "skinTemperature",
  // ── sleep (also has the dedicated get_sleep tool, but the raw duration
  //    series is reachable here too) ──
  sleep: "sleep",
  body_temp: "bodyTemperature",
};

/**
 * v1.21.0 (C2-3) — human-readable domain label per metric source, for the DATA
 * INVENTORY lines. Brand-free, lower-case, stable across turns so the cached
 * prefix holds. Every key in `COACH_SOURCE_SNAPSHOT_KEY` plus the dedicated-tool
 * sources has an entry; the inventory renders one line per series source the
 * user actually has rows for.
 */
export const COACH_SOURCE_DOMAIN_LABEL: Readonly<
  Partial<Record<CoachScopeSource, string>>
> = {
  bp: "blood pressure",
  weight: "weight",
  pulse: "pulse",
  mood: "mood",
  hrv: "heart-rate variability",
  resting_hr: "resting heart rate",
  walking_hr: "walking heart rate",
  respiratory_rate: "respiratory rate",
  spo2: "blood oxygen (SpO2)",
  pulse_wave_velocity: "pulse-wave velocity",
  vascular_age: "vascular age",
  body_fat: "body fat",
  fat_mass: "fat mass",
  fat_free_mass: "fat-free mass",
  muscle_mass: "muscle mass",
  lean_body_mass: "lean body mass",
  bone_mass: "bone mass",
  total_body_water: "total body water",
  bmi: "BMI",
  visceral_fat: "visceral fat",
  steps: "steps",
  active_energy: "active energy",
  flights: "flights climbed",
  distance: "walking/running distance",
  vo2_max: "VO2 max",
  walking_steadiness: "walking steadiness",
  walking_asymmetry: "walking asymmetry",
  walking_double_support: "walking double support",
  walking_step_length: "walking step length",
  walking_speed: "walking speed",
  audio_env: "environmental audio exposure",
  audio_headphone: "headphone audio exposure",
  audio_event: "audio exposure events",
  daylight: "time in daylight",
  skin_temp: "skin temperature",
  sleep: "sleep",
  body_temp: "body temperature",
};

/**
 * v1.21.0 (C2-2 / C2-3) — the FULL set of metric-series sources the inventory
 * probes for presence: every source `get_metric_series` can serve (the
 * `COACH_SOURCE_SNAPSHOT_KEY` keys), minus the few that ride a dedicated tool
 * (sleep has `get_sleep`; glucose/compliance/workouts are excluded). The
 * inventory is built against this full set so a domain with data is advertised
 * regardless of the user's narration-cluster preference — closing the
 * default-cluster reach gap. `sleep` is omitted here because `get_sleep` owns
 * its inventory line.
 */
export const METRIC_SERIES_INVENTORY_SOURCES: ReadonlyArray<CoachScopeSource> =
  (Object.keys(COACH_SOURCE_SNAPSHOT_KEY) as CoachScopeSource[]).filter(
    (source) => source !== "sleep",
  );

/**
 * v1.21.0 (C2-2) — the full source set the inventory snapshot is built against,
 * so every domain with stored rows reports `present` (not the default-cluster
 * subset). The per-tool reads still re-scope to the exact domain, so widening
 * the inventory probe never widens a figure read. This is the canonical enum
 * (every `CoachScopeSource`) — the snapshot builder only emits a block when the
 * matching source has rows, so probing the full set is presence-only.
 */
export const FULL_INVENTORY_SOURCE_SET: ReadonlyArray<CoachScopeSource> =
  COACH_SCOPE_SOURCES;
