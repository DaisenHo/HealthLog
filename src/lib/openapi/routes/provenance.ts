/**
 * OpenAPI route table — source provenance (#1204, #1108, #576).
 *
 * Part of the OpenAPI route table; aggregated in `./index.ts`. The schemas
 * are the runtime ones from `@/lib/validations/source-provenance`.
 */
import type { ZodOpenApiObject } from "zod-openapi";

import {
  dayProvenanceQuerySchema,
  dayProvenanceResponseSchema,
  sourceComparisonQuerySchema,
  sourceComparisonResponseSchema,
} from "@/lib/validations/source-provenance";

import { dataEnvelope, recordRefusal, stdResponses } from "./shared";

export const provenancePaths: NonNullable<ZodOpenApiObject["paths"]> = {
  "/api/measurements/provenance": {
    get: {
      tags: ["Measurements"],
      summary: "Which source a metric's day value comes from",
      description:
        "For one metric and one UTC day: every source with readings, its day value (the total for a cumulative metric, sleep counting asleep stages only, the mean otherwise), its rank on the person's source-priority ladder, and which source the canonical readers use, with the reason. Computed by the same rank SQL the charts, rollups and summaries pick with, so the answer is what they show. A metric without a ladder reports `ranked: false` and no pick: every source counts there. Read-only.",
      requestParams: { query: dayProvenanceQuerySchema },
      responses: {
        "200": {
          description: "The day's sources and the pick.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                dayProvenanceResponseSchema,
                "DayProvenanceEnvelope",
              ),
            },
          },
        },
        ...recordRefusal(),
        ...stdResponses,
      },
    },
  },
  "/api/measurements/provenance/compare": {
    get: {
      tags: ["Measurements"],
      summary: "Two sources of one metric side by side",
      description:
        "Per UTC day over up to 366 days: the day value from source `a` and from source `b`, and which source the ladder picked that day among all of the day's sources. The summary averages only the days both sources cover. Without `a` / `b` the two sources covering the most days are compared. Read-only.",
      requestParams: { query: sourceComparisonQuerySchema },
      responses: {
        "200": {
          description: "The comparison.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                sourceComparisonResponseSchema,
                "SourceComparisonEnvelope",
              ),
            },
          },
        },
        ...recordRefusal(),
        ...stdResponses,
      },
    },
  },
};
