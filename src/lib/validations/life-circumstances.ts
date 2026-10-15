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
