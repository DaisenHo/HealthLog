/**
 * OpenAPI route table — AI usage levels (v1.43, #1217).
 *
 * Part of the OpenAPI route table; aggregated in `./index.ts`. The request
 * body reuses the runtime schema from `@/lib/validations/ai-usage`;
 * `AiUsageState` is the block `GET /api/auth/me` publishes as `ai.usage`
 * (see `AiAccountBlock` in `./profile`), and the PUT answers the same shape.
 */
import type { ZodOpenApiObject } from "zod-openapi";
import { z } from "zod/v4";

import { AI_USAGE_LEVELS, aiUsagePutSchema } from "@/lib/validations/ai-usage";

import { dataEnvelope, errorEnvelope, stdResponses } from "./shared";

export const aiUsageLevel = z.enum(AI_USAGE_LEVELS).meta({
  id: "AiUsageLevel",
  description:
    "How much background AI work an account asks for, in ceiling order. `frugal`: status cards regenerate at most every 24 h after a sync and every 6 h after a hand entry, a smaller snapshot, no background reasoning, a short daily briefing (`recommendations` holds at most one entry, every field stays present), no automatic document reading, no supplement label reading. `standard`: the operator's sync gap (default 6 h), 1 h after a hand entry, background reasoning at the job default. `full`: 1 h after any ingest (the behaviour before v1.43). The interactive Coach is the same at every level.",
});

export const aiUsageState = z
  .object({
    level: aiUsageLevel.describe("The level in effect for this record."),
    preference: aiUsageLevel
      .nullable()
      .describe(
        "The account's stored choice; `null` follows the instance default.",
      ),
    defaultLevel: aiUsageLevel.describe(
      "The level an account without its own choice runs at.",
    ),
    maxLevel: aiUsageLevel.describe(
      "The highest level the operator allows on this server.",
    ),
    source: z
      .enum(["user", "default", "admin_cap"])
      .describe(
        "Where `level` comes from: the stored choice, the instance default, or the operator's ceiling capping a stored choice above it (the choice is kept).",
      ),
    options: z
      .array(
        z.object({
          level: aiUsageLevel,
          allowed: z.boolean().describe("`level` is at or below `maxLevel`."),
          estimatedTokensPerDay: z
            .number()
            .int()
            .nullable()
            .describe(
              "An estimate, from this account's measured use scaled to the level. `null` without three days of history. Show it as an estimate; never compute one on the client.",
            ),
        }),
      )
      .length(3)
      .describe("Always three entries, in the order frugal, standard, full."),
    measuredTokensPerDay: z
      .number()
      .int()
      .nullable()
      .describe(
        "Mean tokens per day over the last seven full days (Coach and background work together); `null` without history.",
      ),
    measuredDays: z
      .number()
      .int()
      .min(0)
      .max(7)
      .describe("How many days stand behind `measuredTokensPerDay`."),
  })
  .meta({
    id: "AiUsageState",
    description:
      "The account's AI usage level, resolved on the server. Clients render the picker from `options` and never derive allowance or estimates themselves. Absent on servers older than v1.43.",
  });

const aiUsagePutRequest = aiUsagePutSchema.meta({
  id: "AiUsagePutRequest",
  description:
    "Set the account's own AI usage level; `null` returns to the instance default. A level above `maxLevel` is refused, never capped silently.",
});

export const aiUsagePaths: NonNullable<ZodOpenApiObject["paths"]> = {
  "/api/auth/me/ai-usage": {
    put: {
      tags: ["Profile"],
      summary: "Set the AI usage level (v1.43)",
      description:
        "Own account only: a cookie session or a full-scope token. Answers the resolved `AiUsageState`. 422 `ai.usage.invalid` for a malformed body; 422 `ai.usage.aboveCeiling` with `meta.maxLevel` for a level above the operator's ceiling; 429 `ai.usage.rateLimited` after 30 changes in an hour.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: aiUsagePutRequest } },
      },
      responses: {
        "200": {
          description: "The resolved AI usage state after the change.",
          content: {
            "application/json": {
              schema: dataEnvelope(aiUsageState, "PutAiUsageResponse"),
            },
          },
        },
        ...stdResponses,
        "422": {
          description:
            "`ai.usage.invalid` (body) or `ai.usage.aboveCeiling` (`meta.maxLevel` names the ceiling).",
          content: { "application/json": { schema: errorEnvelope } },
        },
      },
    },
  },
};
