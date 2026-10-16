/**
 * v1.18.6 — query schema for `GET /api/measurements/series-batch`.
 *
 * Kept in its own file (not inline in the route) so the OpenAPI registry
 * can import it and the wire contract stays single-source, mirroring the
 * `listMeasurementsSchema` convention.
 */
import { z } from "zod/v4";
import { measurementTypeEnum } from "@/lib/validations/measurement";
import { isoDateTime } from "@/lib/validations/datetime";

/** Upper bound on the types per batch — the dashboard never asks for more. */
export const SERIES_BATCH_MAX_TYPES = 16;

export const seriesBatchQuerySchema = z
  .object({
    types: z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      )
      .pipe(z.array(measurementTypeEnum).min(1).max(SERIES_BATCH_MAX_TYPES))
      .describe(
        "Comma-separated list of MeasurementType values (1.." +
          `${SERIES_BATCH_MAX_TYPES}). Each is read as a daily series through ` +
          "the rollup tier.",
      ),
    from: isoDateTime()
      .transform((s) => new Date(s))
      .describe("Window start (ISO-8601 instant)."),
    to: isoDateTime()
      .transform((s) => new Date(s))
      .describe("Window end (ISO-8601 instant)."),
  })
  .meta({
    id: "MeasurementsSeriesBatchQuery",
    description:
      "Batched daily-series request — returns every requested type's rollup-backed daily series in one response.",
  });

export type SeriesBatchInput = z.infer<typeof seriesBatchQuerySchema>;
