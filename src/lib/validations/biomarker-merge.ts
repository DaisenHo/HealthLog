/**
 * v1.43 — merging biomarkers. `{id}` in the path is the marker that
 * stays; `sourceIds` are folded into it. That the target is not among the
 * sources is checked by the route, which knows the path id.
 */
import { z } from "zod/v4";

export const BIOMARKER_MERGE_MAX_SOURCES = 10;

export const biomarkerMergeSchema = z
  .strictObject({
    sourceIds: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(BIOMARKER_MERGE_MAX_SOURCES),
    dryRun: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.sourceIds).size !== value.sourceIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceIds"],
        message: "sourceIds must be unique",
      });
    }
  });
export type BiomarkerMergeInput = z.infer<typeof biomarkerMergeSchema>;

export const BIOMARKER_MERGE_CONVERSIONS = [
  "none",
  "converted",
  "refused",
] as const;
export const BIOMARKER_MERGE_REFUSALS = [
  "unknown_analyte",
  "unknown_unit",
  "not_finite",
] as const;
