/**
 * v1.43 (#1107 follow-up) — the admin pulse day-mean dry run and apply step.
 *
 * The status shape is the admin console's own and stays out of the published
 * API description: the admin routes are not part of the public contract.
 */
import { z } from "zod/v4";

import type { PulseDayMeanMethod } from "@/lib/measurements/day-statistic";

export const pulseDayMeanActionSchema = z.strictObject({
  // `rebuild` runs the recalculation again after an apply whose rebuild
  // stopped, without a new dry run: the method is already switched.
  action: z.enum(["dry_run", "apply", "rebuild"]),
});
export type PulseDayMeanActionInput = z.infer<typeof pulseDayMeanActionSchema>;

/** Where a day's change between the two methods falls, in bpm. */
export const PULSE_DAY_MEAN_CHANGE_BUCKETS = [
  "0-1",
  "1-2",
  "2-5",
  "5+",
] as const;

/**
 * What a dry run found. Accounts are numbered in the order they were created
 * (`"#1"`, `"#2"`, …), never named or identified.
 */
const dryRunResultSchema = z.object({
  accounts: z.number().int().nonnegative(),
  daysCompared: z.number().int().nonnegative(),
  daysChangedOver1Bpm: z.number().int().nonnegative(),
  maxChangeBpm: z.number().nonnegative(),
  distribution: z.array(
    z.object({
      bucket: z.enum(PULSE_DAY_MEAN_CHANGE_BUCKETS),
      days: z.number().int().nonnegative(),
    }),
  ),
  perAccount: z.array(
    z.object({
      account: z.string(),
      days: z.number().int().nonnegative(),
      changedOver1Bpm: z.number().int().nonnegative(),
    }),
  ),
});
export type PulseDayMeanDryRunResult = z.infer<typeof dryRunResultSchema>;

const runStatusSchema = z.enum(["queued", "running", "done", "failed"]);

/** The last dry run. */
const pulseDayMeanDryRunSchema = z.object({
  status: runStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  result: dryRunResultSchema.nullable(),
});
export type PulseDayMeanDryRun = z.infer<typeof pulseDayMeanDryRunSchema>;

/** The last recalculation of the pulse rollups after an apply. */
const pulseDayMeanRebuildSchema = z.object({
  status: runStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Accounts and rollup rows done; null until the run has finished. */
  accounts: z.number().int().nonnegative().nullable(),
  rows: z.number().int().nonnegative().nullable(),
});
export type PulseDayMeanRebuild = z.infer<typeof pulseDayMeanRebuildSchema>;

/**
 * `app_settings.pulse_day_mean_dry_run_json`: the last dry run, and beside it
 * the last rebuild. One column holds both, because the rebuild only ever
 * follows an apply that needed a dry run; a blob written before the rebuild
 * was recorded has no `rebuild` key and reads as none.
 */
export const pulseDayMeanStoredRunsSchema = pulseDayMeanDryRunSchema.extend({
  rebuild: pulseDayMeanRebuildSchema.nullable().optional(),
});
export type PulseDayMeanStoredRuns = z.infer<
  typeof pulseDayMeanStoredRunsSchema
>;

/** `GET /api/admin/maintenance/pulse-day-mean`. */
export interface PulseDayMeanStatus {
  method: PulseDayMeanMethod;
  appliedAt: string | null;
  lastDryRun: PulseDayMeanDryRun | null;
  lastRebuild: PulseDayMeanRebuild | null;
}

/** How old a finished dry run may be for the apply step to accept it. */
const DRY_RUN_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A finished dry run from the last seven days: the apply step's condition,
 * enforced by the route and mirrored by the admin card's button.
 */
export function hasFreshDryRun(
  status: Pick<PulseDayMeanStatus, "lastDryRun">,
  now: Date = new Date(),
): boolean {
  const run = status.lastDryRun;
  if (!run || run.status !== "done" || run.finishedAt === null) return false;
  const finished = Date.parse(run.finishedAt);
  return (
    Number.isFinite(finished) && now.getTime() - finished <= DRY_RUN_FRESH_MS
  );
}
