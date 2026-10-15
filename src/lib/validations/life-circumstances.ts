/**
 * v1.43 (#614) — life circumstances: six sections of dated, sealed,
 * self-reported context, and AUDIT-C for the alcohol section.
 *
 * Each new fact kind stores a JSON object with `schema: 1`; the kinds are
 * deliberately NOT in `HEALTH_PROFILE_FACT_KINDS` (health-profile-facts.ts),
 * which is what `GET /api/anamnesis/facts` lists: older app builds decode that
 * enum closed. They are read through `GET /api/anamnesis/life-circumstances`.
 * Every question allows "no answer" (`null`, or an empty list).
 */
import { z } from "zod/v4";

import { assertStableExternalId } from "@/lib/validations/external-id";
import {
  ALCOHOL_PATTERN_VALUES,
  HEALTH_PROFILE_FACT_KINDS,
  SHIFT_SCHEDULE_VALUES,
  SMOKING_STATUS_VALUES,
  isHealthProfileFactValue,
} from "@/lib/validations/health-profile-facts";

// ── Fact kinds and their values ──────────────────────────────────────────────

export const LIFE_FACT_KINDS = [
  "TOBACCO_DETAIL",
  "ACTIVITY_HABIT",
  "WORK_CONTEXT",
  "FREE_WEEKDAYS",
  "HABITS",
  "HEALTH_GOALS",
] as const;
export type LifeFactKind = (typeof LIFE_FACT_KINDS)[number];

const schemaVersion = z.literal(1);
const currentYear = () => new Date().getUTCFullYear();

export const TOBACCO_PRODUCTS = [
  "cigarettes",
  "cigars_pipe",
  "e_cigarette",
  "heated_tobacco",
  "snus_pouches",
] as const;

export const tobaccoDetailValueSchema = z
  .strictObject({
    schema: schemaVersion,
    products: z.array(z.enum(TOBACCO_PRODUCTS)).max(TOBACCO_PRODUCTS.length),
    cigarettesPerDay: z.number().int().min(1).max(100).nullable(),
    startYear: z
      .number()
      .int()
      .min(1900)
      .refine((year) => year <= currentYear(), "Not in the future")
      .nullable(),
    quitMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
      .nullable(),
    secondhandSmoke: z.boolean().nullable(),
  })
  .refine(
    (value) =>
      value.cigarettesPerDay === null || value.products.includes("cigarettes"),
    {
      path: ["cigarettesPerDay"],
      message: "Only with cigarettes",
    },
  );

export const activityHabitValueSchema = z.strictObject({
  schema: schemaVersion,
  moderateDaysPerWeek: z.number().int().min(0).max(7).nullable(),
  moderateMinutesPerDay: z.number().int().min(0).max(600).nullable(),
  sittingHoursWorkday: z.number().min(0).max(24).multipleOf(0.5).nullable(),
});

export const WORK_SITUATIONS = ["none", "indoor", "outdoor", "mixed"] as const;
export const WORK_PHYSICAL_NATURE = [
  "mostly_sitting",
  "standing_walking",
  "heavy_physical",
] as const;
export const WORK_EXPOSURES = [
  "heat",
  "cold",
  "dust",
  "fumes_solvents",
  "noise",
] as const;

export const workContextValueSchema = z.strictObject({
  schema: schemaVersion,
  situation: z.enum(WORK_SITUATIONS).nullable(),
  physicalNature: z.enum(WORK_PHYSICAL_NATURE).nullable(),
  nightWork: z.boolean().nullable(),
  exposures: z.array(z.enum(WORK_EXPOSURES)).max(WORK_EXPOSURES.length),
});

export const freeWeekdaysValueSchema = z.strictObject({
  schema: schemaVersion,
  /** ISO weekdays, 1 = Monday. */
  days: z.array(z.number().int().min(1).max(7)).max(7),
});

export const DIET_PATTERNS = [
  "mixed",
  "vegetarian",
  "vegan",
  "pescetarian",
  "other",
] as const;
export const DIET_SPECIFICS = [
  "intermittent_fasting",
  "low_carb",
  "prescribed_diet",
] as const;
export const LATEST_CAFFEINE = [
  "before_12",
  "12_15",
  "15_18",
  "after_18",
] as const;

export const habitsValueSchema = z.strictObject({
  schema: schemaVersion,
  napRegularly: z.boolean().nullable(),
  snoringReported: z.boolean().nullable(),
  dietPattern: z.enum(DIET_PATTERNS).nullable(),
  dietSpecifics: z.array(z.enum(DIET_SPECIFICS)).max(DIET_SPECIFICS.length),
  lateMealsPerWeek: z.number().int().min(0).max(7).nullable(),
  fruitVegPortionsPerDay: z.number().int().min(0).max(15).nullable(),
  caffeineDrinksPerDay: z.number().int().min(0).max(20).nullable(),
  latestCaffeine: z.enum(LATEST_CAFFEINE).nullable(),
});

export const HEALTH_GOALS = [
  "weight",
  "blood_pressure",
  "blood_sugar",
  "sleep",
  "fitness",
  "stress_recovery",
  "medication_routine",
  "quit_smoking",
  "less_alcohol",
] as const;

export const healthGoalsValueSchema = z.strictObject({
  schema: schemaVersion,
  goals: z.array(z.enum(HEALTH_GOALS)).max(3),
});

/** The value schema per kind, the one map every writer and reader uses. */
export const LIFE_FACT_VALUE_SCHEMAS = {
  TOBACCO_DETAIL: tobaccoDetailValueSchema,
  ACTIVITY_HABIT: activityHabitValueSchema,
  WORK_CONTEXT: workContextValueSchema,
  FREE_WEEKDAYS: freeWeekdaysValueSchema,
  HABITS: habitsValueSchema,
  HEALTH_GOALS: healthGoalsValueSchema,
} as const satisfies Record<LifeFactKind, z.ZodType>;

// ── Sections ─────────────────────────────────────────────────────────────────

export const LIFE_SECTION_KEYS = [
  "tobacco",
  "alcohol",
  "activity",
  "work",
  "habits",
  "goals",
] as const;
export type LifeSectionKey = (typeof LIFE_SECTION_KEYS)[number];

/** The AI sections the life-circumstances surface switches. */
export const LIFE_AI_SECTIONS = [
  "SMOKING_STATUS",
  "ALCOHOL_PATTERN",
  "SHIFT_SCHEDULE",
  "ACTIVITY",
  "WORK",
  "HABITS",
  "GOALS",
] as const;
export type LifeAiSection = (typeof LIFE_AI_SECTIONS)[number];

/** `PATCH /api/anamnesis/life-circumstances/ai-sections`. */
export const lifeAiSectionsPatchSchema = z
  .strictObject({
    sections: z.partialRecord(z.enum(LIFE_AI_SECTIONS), z.boolean()),
    baseUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => Object.keys(value.sections).length > 0, {
    path: ["sections"],
    message: "At least one section",
  });
export type LifeAiSectionsPatchInput = z.infer<
  typeof lifeAiSectionsPatchSchema
>;

/** `POST /api/anamnesis/life-circumstances/confirm`. */
export const lifeConfirmSchema = z.strictObject({
  section: z.enum(LIFE_SECTION_KEYS),
});

// ── AUDIT-C ──────────────────────────────────────────────────────────────────

const auditCItem = z.number().int().min(0).max(4);

/** `POST /api/anamnesis/audit-c`. */
export const auditCRequestSchema = z
  .strictObject({
    items: z.tuple([auditCItem, auditCItem, auditCItem]),
    takenAt: z.iso.datetime({ offset: true }).optional(),
    tz: z.string().min(1).max(64).optional(),
    locale: z.string().min(2).max(16).optional(),
    source: z.enum(["WEB", "IOS"]),
    externalId: z.string().min(1).max(128).optional(),
  })
  .superRefine(assertStableExternalId);
export type AuditCRequestInput = z.infer<typeof auditCRequestSchema>;

export const AUDIT_C_CUTOFF_SOURCES = [
  "S3_ALCOHOL_DE",
  "KNHANES_KR",
  "BRADLEY_2007",
] as const;

// ── Writing facts through `/api/anamnesis/facts` ─────────────────────────────

/** Every kind a fact revision row can carry: the three closed ones and the six above. */
export const STORED_FACT_KINDS = [
  ...HEALTH_PROFILE_FACT_KINDS,
  ...LIFE_FACT_KINDS,
] as const;
export type StoredFactKind = (typeof STORED_FACT_KINDS)[number];

export function isLifeFactKind(kind: string): kind is LifeFactKind {
  return (LIFE_FACT_KINDS as readonly string[]).includes(kind);
}

/**
 * "Valid since", a calendar day. Optional: without it the answer holds from
 * the moment it is saved. The web form sends the first of a month, because a
 * month is as precise as anyone remembers when they stopped smoking.
 */
const validFromDay = z.iso
  .date()
  .optional()
  .describe(
    "The calendar day the answer holds from (UTC midnight). Omitted, it holds from now. Never later than today; an earlier day than the end of the previous answer of the same kind starts at that end instead.",
  );

/**
 * `POST /api/anamnesis/facts`. The three closed kinds keep their string value
 * (older app builds send exactly that); the six life-circumstance kinds send
 * their object value with `schema: 1`.
 */
export const factWriteSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SMOKING_STATUS"),
    value: z.enum(SMOKING_STATUS_VALUES),
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("ALCOHOL_PATTERN"),
    value: z.enum(ALCOHOL_PATTERN_VALUES),
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("SHIFT_SCHEDULE"),
    value: z.enum(SHIFT_SCHEDULE_VALUES),
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("TOBACCO_DETAIL"),
    value: tobaccoDetailValueSchema,
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("ACTIVITY_HABIT"),
    value: activityHabitValueSchema,
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("WORK_CONTEXT"),
    value: workContextValueSchema,
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("FREE_WEEKDAYS"),
    value: freeWeekdaysValueSchema,
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("HABITS"),
    value: habitsValueSchema,
    validFrom: validFromDay,
  }),
  z.object({
    kind: z.literal("HEALTH_GOALS"),
    value: healthGoalsValueSchema,
    validFrom: validFromDay,
  }),
]);
export type FactWriteInput = z.infer<typeof factWriteSchema>;

/**
 * `PATCH /api/anamnesis/facts/{id}`: the closed kinds take a string, the life
 * kinds an object; which one the row needs is checked against the stored
 * kind after the row is found.
 */
export const factCorrectionSchema = z.object({
  value: z.union([z.string().trim().min(1), z.record(z.string(), z.unknown())]),
  validFrom: validFromDay,
});

/** Parse a life-circumstance value against its kind's schema; null when it does not fit. */
export function parseLifeFactValue(
  kind: LifeFactKind,
  value: unknown,
): LifeFactValue | null {
  const parsed = LIFE_FACT_VALUE_SCHEMAS[kind].safeParse(value);
  return parsed.success ? (parsed.data as LifeFactValue) : null;
}

export type TobaccoDetailValue = z.infer<typeof tobaccoDetailValueSchema>;
export type ActivityHabitValue = z.infer<typeof activityHabitValueSchema>;
export type WorkContextValue = z.infer<typeof workContextValueSchema>;
export type FreeWeekdaysValue = z.infer<typeof freeWeekdaysValueSchema>;
export type HabitsValue = z.infer<typeof habitsValueSchema>;
export type HealthGoalsValue = z.infer<typeof healthGoalsValueSchema>;
export type LifeFactValue =
  | TobaccoDetailValue
  | ActivityHabitValue
  | WorkContextValue
  | FreeWeekdaysValue
  | HabitsValue
  | HealthGoalsValue;

/** `DELETE /api/anamnesis/facts/{id}`: the revision whose interval was closed. */
export const removedFactSchema = z.object({
  id: z.string(),
  kind: z.enum(STORED_FACT_KINDS),
  removedAt: z.iso.datetime({ offset: true }),
});

/**
 * A life-circumstance revision as `/api/anamnesis/life-circumstances` and the
 * fact writes answer it. `SMOKING_STATUS` and `SHIFT_SCHEDULE` ride along in
 * their sections with their string value.
 */
export const lifeFactRevisionSchema = z.object({
  id: z.string(),
  kind: z.enum(["SMOKING_STATUS", "SHIFT_SCHEDULE", ...LIFE_FACT_KINDS]),
  value: z
    .unknown()
    .describe(
      "`SMOKING_STATUS` and `SHIFT_SCHEDULE` carry their string value; every other kind an object with `schema: 1` whose shape is fixed per kind (see the life-circumstances contract). `null` when `unreadable`.",
    ),
  unreadable: z
    .boolean()
    .describe("The sealed value could not be opened on this host."),
  validFrom: z.iso.datetime({ offset: true }),
  validUntil: z.null(),
  provenance: z.enum(["USER_REPORTED", "USER_CORRECTION"]),
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * Whether `raw` is a valid plaintext for a stored fact of `kind`: one of the
 * closed values for the three original kinds, the JSON of a value that fits
 * its schema for the life kinds. The portable backup carries exactly this
 * plaintext, so its writer and its restore share this one check.
 */
export function isStoredFactPlaintext(
  kind: StoredFactKind,
  raw: string,
): boolean {
  if (!isLifeFactKind(kind)) return isHealthProfileFactValue(kind, raw);
  try {
    return parseLifeFactValue(kind, JSON.parse(raw)) !== null;
  } catch {
    return false;
  }
}
