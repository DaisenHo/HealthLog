/**
 * v1.16.5 — request schema for
 * `POST /api/medications/{id}/schedule-revisions`.
 *
 * Lives outside the route file so the OpenAPI registry can import it
 * without dragging `@/lib/db` into the generator script — the same
 * split as `src/lib/validations/invite.ts`.
 *
 * The endpoint appends a MANUAL schedule era ("the medication dosed at
 * 07:00/19:00 from March to June, before I tracked it here"). The body
 * carries the era bounds as instants plus the daily times-of-day the
 * era dosed at; the route derives the snapshot payload entry
 * (`FREQ=DAILY`, window pulled to min/max of the times) so the era
 * minter reads it exactly like a write-path archive.
 */
import { z } from "zod/v4";
import { isoDateTime } from "@/lib/validations/datetime";

/** HH:mm wall-clock literal — mirrors `validations/medication.ts`. */
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const scheduleRevisionCreateSchema = z
  .object({
    /** Inclusive start instant of the manual era. */
    validFrom: isoDateTime().describe(
      "Inclusive start instant of the manual era (ISO 8601).",
    ),
    /**
     * Exclusive end instant — the moment the next plan took over. Must
     * lie after `validFrom` and at or before the start of the live
     * schedule era (the newest archived revision's `validUntil`, or
     * "now" when no revision exists yet).
     */
    validUntil: isoDateTime().describe(
      "Exclusive end instant of the manual era (ISO 8601). Must precede the current plan.",
    ),
    /**
     * Daily dose times the era ran at. Same cap as live schedules.
     * Duplicates collapse and the result sorts ascending — "07:00,
     * 07:00, 19:00" and "19:00, 07:00" both normalise to
     * ["07:00", "19:00"], so a double-tapped chip never mints a
     * double-counted slot.
     */
    timesOfDay: z
      .array(z.string().regex(timeRegex, "Format: HH:mm"))
      .min(1)
      .max(8)
      .transform((times) =>
        [...new Set(times)].sort((a, b) => a.localeCompare(b)),
      )
      .describe(
        "Daily dose times (HH:mm, user local) the era ran at. 1–8 entries; duplicates are collapsed.",
      ),
  })
  .refine(
    (body) =>
      new Date(body.validFrom).getTime() < new Date(body.validUntil).getTime(),
    {
      message: "validFrom must lie before validUntil",
      path: ["validUntil"],
    },
  )
  .meta({
    id: "CreateScheduleRevisionRequest",
    description:
      "Manual schedule-era payload: era bounds plus the daily dose times that were live during the era.",
  });

export type ScheduleRevisionCreateInput = z.infer<
  typeof scheduleRevisionCreateSchema
>;

/**
 * v1.16.6 — request schema for
 * `PATCH /api/medications/{id}/schedule-revisions/{revisionId}`.
 *
 * A correction carries the same full era shape as a create: bounds plus
 * daily times. MANUAL eras update in place; ARCHIVED eras stay as the
 * audit record and the correction is minted as a superseding MANUAL
 * row. Field-for-field identical to the create schema — only the meta
 * id differs so the OpenAPI document names the two requests apart.
 */
export const scheduleRevisionUpdateSchema = scheduleRevisionCreateSchema.meta({
  id: "UpdateScheduleRevisionRequest",
  description:
    "Corrected schedule-era payload: replacement era bounds plus the daily dose times that were live during the era.",
});

export type ScheduleRevisionUpdateInput = z.infer<
  typeof scheduleRevisionUpdateSchema
>;
