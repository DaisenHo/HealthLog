/**
 * Wire schemas of the source-provenance reads (#1204, #1108, #576).
 */
import { z } from "zod/v4";

import {
  measurementSourceEnum,
  measurementTypeEnum,
} from "@/lib/validations/measurement";

export const PROVENANCE_MAX_DAYS = 366;

export const dayProvenanceQuerySchema = z.object({
  type: measurementTypeEnum.describe("The metric."),
  date: z.iso
    .date()
    .describe(
      "The UTC day (`YYYY-MM-DD`). The source ladder picks one source per UTC day, so this is the day the pick is explained for.",
    ),
});

export const sourceComparisonQuerySchema = z
  .object({
    type: measurementTypeEnum.describe("The metric."),
    from: z.iso.date().describe("First UTC day, inclusive."),
    to: z.iso.date().describe("Last UTC day, inclusive."),
    a: measurementSourceEnum
      .optional()
      .describe("First source. Defaults to the source covering the most days."),
    b: measurementSourceEnum
      .optional()
      .describe("Second source. Defaults to the next one."),
  })
  .refine((q) => q.from <= q.to, {
    message: "from must not be after to",
    path: ["from"],
  })
  .refine(
    (q) =>
      (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <
      PROVENANCE_MAX_DAYS,
    { message: `At most ${PROVENANCE_MAX_DAYS} days`, path: ["to"] },
  );

const pickReasonEnum = z
  .enum(["only_source", "highest_on_ladder", "name_tiebreak", "not_ranked"])
  .describe(
    "`only_source`: one source that day. `highest_on_ladder`: it stands highest on the ladder among the day's sources. `name_tiebreak`: none of them is on the ladder, the source name decided. `not_ranked`: this metric has no ladder, every source counts.",
  );

const passReasonEnum = z
  .enum(["lower_on_ladder", "not_on_ladder", "name_tiebreak"])
  .nullable()
  .describe("Why this source was not the one picked; null for the picked one.");

const sourceRowSchema = z.object({
  source: measurementSourceEnum,
  rank: z
    .number()
    .int()
    .describe("Position on the ladder, 0 = highest; 90 = not on the ladder."),
  readings: z.number().int(),
  value: z
    .number()
    .nullable()
    .describe(
      "The day's value from this source: the day total for a cumulative metric (sleep counts asleep stages only), the mean of the readings otherwise.",
    ),
  min: z.number().nullable(),
  max: z.number().nullable(),
  firstAt: z.string().describe("ISO instant of the first reading that day."),
  lastAt: z.string(),
  unit: z.string().nullable(),
  devices: z
    .array(z.string())
    .describe("Device kinds the readings carry; `unknown` when untagged."),
});

export const dayProvenanceResponseSchema = z
  .object({
    type: measurementTypeEnum,
    date: z.iso.date(),
    aggregation: z.enum(["sum", "mean"]),
    ranked: z.boolean(),
    metricKey: z.string().nullable(),
    ladder: z.array(measurementSourceEnum),
    picked: measurementSourceEnum.nullable(),
    pickReason: pickReasonEnum.nullable(),
    sources: z.array(sourceRowSchema.extend({ pass: passReasonEnum })),
  })
  .meta({ id: "DayProvenance" });

export const sourceComparisonResponseSchema = z
  .object({
    type: measurementTypeEnum,
    from: z.iso.date(),
    to: z.iso.date(),
    aggregation: z.enum(["sum", "mean"]),
    ranked: z.boolean(),
    ladder: z.array(measurementSourceEnum),
    unit: z.string().nullable(),
    sources: z.array(
      z.object({ source: measurementSourceEnum, days: z.number().int() }),
    ),
    a: measurementSourceEnum.nullable(),
    b: measurementSourceEnum.nullable(),
    days: z.array(
      z.object({
        date: z.iso.date(),
        a: z.number().nullable(),
        b: z.number().nullable(),
        picked: measurementSourceEnum.nullable(),
      }),
    ),
    summary: z.object({
      daysA: z.number().int(),
      daysB: z.number().int(),
      daysBoth: z.number().int(),
      meanA: z.number().nullable(),
      meanB: z.number().nullable(),
      meanDifference: z.number().nullable(),
      meanAbsoluteDifference: z.number().nullable(),
      pickedA: z.number().int(),
      pickedB: z.number().int(),
    }),
  })
  .meta({ id: "SourceComparison" });

export type DayProvenanceResponse = z.infer<typeof dayProvenanceResponseSchema>;
export type SourceComparisonResponse = z.infer<
  typeof sourceComparisonResponseSchema
>;
