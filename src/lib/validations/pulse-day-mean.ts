/**
 * v1.43 (#1107 follow-up) — the admin pulse day-mean dry run and apply step.
 */
import { z } from "zod/v4";

export const PULSE_DAY_MEAN_METHODS = [
  "hour_mean_v1",
  "weighted_hour_mean_v2",
] as const;

export const pulseDayMeanActionSchema = z.strictObject({
  action: z.enum(["dry_run", "apply"]),
});
export type PulseDayMeanActionInput = z.infer<typeof pulseDayMeanActionSchema>;
