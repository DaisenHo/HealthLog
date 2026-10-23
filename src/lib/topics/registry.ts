/**
 * The topic pages (preview): which signals each topic brings together, which
 * pairs it checks against each other and which extra blocks it carries.
 *
 * A topic is an overview layer above the single-metric Insights pages. It
 * never owns a number of its own: every value is the same daily value the
 * metric page draws, and every topic links into those pages. This file is the
 * one declaration; the server builds from it (`build.ts`) and the browser
 * imports only the keys and labels, so it carries constants and types only.
 *
 * Module ownership is not restated here. A measurement signal follows its
 * type's owner (`moduleForMeasurementType`), the mood signal follows `mood`,
 * and the extra blocks name their module in {@link TOPIC_EXTRA_MODULE}. A
 * topic is offered when at least one of its {@link TopicDefinition.modules}
 * is on (an empty list means it rides core signals and is always offered);
 * inside it, each signal and block shows only when its own owner is on.
 */
import type { MeasurementType } from "@/generated/prisma/enums";
import type { ModuleKey } from "@/lib/modules/registry";

/** The topics, in the overview's reading order. Also the URL slugs. */
export const TOPIC_KEYS = [
  "heart",
  "body",
  "blood-pressure",
  "sleep",
  "activity",
  "metabolism",
  "mind",
  "cycle",
] as const;

export type TopicKey = (typeof TOPIC_KEYS)[number];

export function isTopicKey(value: unknown): value is TopicKey {
  return (
    typeof value === "string" &&
    (TOPIC_KEYS as readonly string[]).includes(value)
  );
}

/** The mood score (1 to 5, the day's mean of its entries) as a signal. */
export const MOOD_SIGNAL = "MOOD";

/** A daily series a topic reads: a measurement type or the mood score. */
export type TopicSignalKey = MeasurementType | typeof MOOD_SIGNAL;

/** The extra blocks a topic may carry beside its signals. */
export type TopicExtra = "training" | "labs" | "screeners" | "cycle";

/** The module each extra block follows. */
export const TOPIC_EXTRA_MODULE: Readonly<Record<TopicExtra, ModuleKey>> = {
  training: "workouts",
  labs: "labs",
  screeners: "mentalHealth",
  cycle: "cycle",
};

/**
 * One pair a topic checks. `x` on day d is held against `y` on day
 * d + `lagDays`. A sleep night is keyed by the day it ended, so "the night
 * before" and "that morning" share a key and need no lag.
 *
 * `correlation` reports Pearson's r; `split` compares the mean of `y` on the
 * days `x` sat below `threshold` (in `x`'s stored unit) with the other days.
 */
export interface TopicRelationshipDef {
  id: string;
  x: TopicSignalKey;
  y: TopicSignalKey;
  lagDays: 0 | 1;
  kind: "correlation" | "split";
  threshold?: number;
}

export interface TopicDefinition {
  key: TopicKey;
  /** Any one of these on offers the topic; empty means core signals carry it. */
  modules: readonly ModuleKey[];
  /** Display order. The first one with data is the topic's headline. */
  signals: readonly TopicSignalKey[];
  /** The side-by-side chart, top to bottom (at most three). */
  chart: readonly TopicSignalKey[];
  relationships: readonly TopicRelationshipDef[];
  extras: readonly TopicExtra[];
}

/** Seven hours, in the minutes `SLEEP_DURATION` is stored in. */
const SHORT_NIGHT_MINUTES = 420;

export const TOPICS: Readonly<Record<TopicKey, TopicDefinition>> = {
  heart: {
    key: "heart",
    modules: [],
    signals: [
      "RESTING_HEART_RATE",
      "HEART_RATE_VARIABILITY",
      "VO2_MAX",
      "PULSE",
    ],
    chart: ["RESTING_HEART_RATE", "HEART_RATE_VARIABILITY", "SLEEP_DURATION"],
    relationships: [
      {
        id: "short-nights-resting-hr",
        x: "SLEEP_DURATION",
        y: "RESTING_HEART_RATE",
        lagDays: 0,
        kind: "split",
        threshold: SHORT_NIGHT_MINUTES,
      },
      {
        id: "hrv-resting-hr",
        x: "HEART_RATE_VARIABILITY",
        y: "RESTING_HEART_RATE",
        lagDays: 0,
        kind: "correlation",
      },
      {
        id: "exercise-next-day-hrv",
        x: "EXERCISE_MINUTES",
        y: "HEART_RATE_VARIABILITY",
        lagDays: 1,
        kind: "correlation",
      },
    ],
    extras: ["training"],
  },
  body: {
    key: "body",
    modules: [],
    signals: [
      "WEIGHT",
      "BODY_FAT",
      "BODY_MASS_INDEX",
      "MUSCLE_MASS",
      "WAIST_CIRCUMFERENCE",
      "VISCERAL_FAT",
    ],
    chart: ["WEIGHT", "BODY_FAT", "MUSCLE_MASS"],
    relationships: [
      {
        id: "active-energy-next-day-weight",
        x: "ACTIVE_ENERGY_BURNED",
        y: "WEIGHT",
        lagDays: 1,
        kind: "correlation",
      },
    ],
    extras: [],
  },
  "blood-pressure": {
    key: "blood-pressure",
    modules: [],
    signals: ["BLOOD_PRESSURE_SYS", "BLOOD_PRESSURE_DIA", "PULSE"],
    chart: ["BLOOD_PRESSURE_SYS", "BLOOD_PRESSURE_DIA", "PULSE"],
    relationships: [
      {
        id: "short-nights-systolic",
        x: "SLEEP_DURATION",
        y: "BLOOD_PRESSURE_SYS",
        lagDays: 0,
        kind: "split",
        threshold: SHORT_NIGHT_MINUTES,
      },
      {
        id: "steps-next-day-systolic",
        x: "ACTIVITY_STEPS",
        y: "BLOOD_PRESSURE_SYS",
        lagDays: 1,
        kind: "correlation",
      },
    ],
    extras: [],
  },
  sleep: {
    key: "sleep",
    modules: ["sleep"],
    signals: [
      "SLEEP_DURATION",
      "RESPIRATORY_RATE",
      "OXYGEN_SATURATION",
      "BREATHING_DISTURBANCES",
    ],
    chart: ["SLEEP_DURATION", "RESPIRATORY_RATE", "HEART_RATE_VARIABILITY"],
    relationships: [
      {
        id: "exercise-sleep",
        x: "EXERCISE_MINUTES",
        y: "SLEEP_DURATION",
        lagDays: 1,
        kind: "correlation",
      },
      {
        id: "sleep-mood",
        x: "SLEEP_DURATION",
        y: MOOD_SIGNAL,
        lagDays: 0,
        kind: "correlation",
      },
    ],
    extras: [],
  },
  activity: {
    key: "activity",
    modules: [],
    signals: [
      "ACTIVITY_STEPS",
      "EXERCISE_MINUTES",
      "ACTIVE_ENERGY_BURNED",
      "WALKING_RUNNING_DISTANCE",
      "FLIGHTS_CLIMBED",
    ],
    chart: ["ACTIVITY_STEPS", "EXERCISE_MINUTES", "ACTIVE_ENERGY_BURNED"],
    relationships: [
      {
        id: "steps-sleep",
        x: "ACTIVITY_STEPS",
        y: "SLEEP_DURATION",
        lagDays: 1,
        kind: "correlation",
      },
      {
        id: "exercise-next-day-resting-hr",
        x: "EXERCISE_MINUTES",
        y: "RESTING_HEART_RATE",
        lagDays: 1,
        kind: "correlation",
      },
    ],
    extras: ["training"],
  },
  metabolism: {
    key: "metabolism",
    modules: ["glucose", "labs"],
    signals: ["BLOOD_GLUCOSE"],
    chart: ["BLOOD_GLUCOSE"],
    relationships: [
      {
        id: "steps-glucose",
        x: "ACTIVITY_STEPS",
        y: "BLOOD_GLUCOSE",
        lagDays: 0,
        kind: "correlation",
      },
      {
        id: "short-nights-glucose",
        x: "SLEEP_DURATION",
        y: "BLOOD_GLUCOSE",
        lagDays: 0,
        kind: "split",
        threshold: SHORT_NIGHT_MINUTES,
      },
    ],
    extras: ["labs"],
  },
  mind: {
    key: "mind",
    modules: ["mood", "mentalHealth"],
    signals: [MOOD_SIGNAL, "PHQ9_SCORE", "GAD7_SCORE", "WHO5_SCORE"],
    chart: [MOOD_SIGNAL, "SLEEP_DURATION", "ACTIVITY_STEPS"],
    relationships: [
      {
        id: "short-nights-mood",
        x: "SLEEP_DURATION",
        y: MOOD_SIGNAL,
        lagDays: 0,
        kind: "split",
        threshold: SHORT_NIGHT_MINUTES,
      },
      {
        id: "steps-mood",
        x: "ACTIVITY_STEPS",
        y: MOOD_SIGNAL,
        lagDays: 0,
        kind: "correlation",
      },
    ],
    extras: ["screeners"],
  },
  cycle: {
    key: "cycle",
    modules: ["cycle"],
    signals: ["WRIST_TEMPERATURE", "RESTING_HEART_RATE"],
    chart: ["WRIST_TEMPERATURE", "RESTING_HEART_RATE"],
    relationships: [],
    extras: ["cycle"],
  },
};

/** The selectable windows of a topic page. */
export const TOPIC_RANGES = ["7d", "30d", "90d", "1y"] as const;
export type TopicRange = (typeof TOPIC_RANGES)[number];
export const DEFAULT_TOPIC_RANGE: TopicRange = "30d";

export const TOPIC_RANGE_DAYS: Readonly<Record<TopicRange, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

/** A relationship says nothing below this many paired days. */
export const RELATIONSHIP_MIN_PAIRED_DAYS = 14;

/** Each side of a `split` needs this many days to be compared at all. */
export const SPLIT_MIN_DAYS_PER_SIDE = 3;

/** The usual range needs this many days of the trailing window. */
export const USUAL_RANGE_MIN_DAYS = 7;

/** The trailing window the usual range, the trends and the pairs read. */
export const TOPIC_BASE_WINDOW_DAYS = 90;

/** A trend over the base window needs this many days with a value. */
export const TREND_MIN_DAYS = 14;

/** Points a relationship ships for its scatter, newest kept. */
export const RELATIONSHIP_MAX_POINTS = 120;

/** Points in an overview tile's sparkline. */
export const SPARKLINE_POINTS = 30;
