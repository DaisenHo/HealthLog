/**
 * OpenAPI route table — the activity calendar and activity goals (D1036).
 *
 * Part of the OpenAPI route table; aggregated in `./index.ts`. The schemas
 * are the runtime ones from `@/lib/validations/activity-*`.
 */
import type { ZodOpenApiObject } from "zod-openapi";

import {
  activityCalendarQuerySchema,
  activityCalendarResponseSchema,
  activityGoalsResponseSchema,
} from "@/lib/validations/activity-calendar";
import { activityGoalsSchema } from "@/lib/validations/activity-goals";

import {
  dataEnvelope,
  MODULE_DISABLED_DESCRIPTION,
  recordRefusal,
  recordWriteRateLimitResponse,
  stdResponses,
} from "./shared";

const activityGoalsPatch = activityGoalsSchema.meta({
  id: "ActivityGoalsPatch",
  description:
    "The goals to change. A key that is present replaces the stored goal (`null` clears it); a key that is absent stays as it is. Unknown keys are refused.",
});

export const activityPaths: NonNullable<ZodOpenApiObject["paths"]> = {
  "/api/activity/calendar": {
    get: {
      tags: ["Measurements"],
      summary: "Activity calendar against the person's own normal",
      description:
        "A week (Monday to Sunday) or a month of activity, computed server-side without AI: per local day the step total (the canonical-source sum the steps chart draws), active minutes (the larger of exercise minutes and workout minutes), workouts by sport after the cross-source collapse, and a training-load score when one exists. Each day is placed against the person's own spread over the 84 days before the period; the period total against the median of the twelve weeks or six months before it, pro-rated while the period runs. Never a population norm. Weekly goals are reported per calendar row, the monthly step goal for a month. Owned by the Workouts module.",
      requestParams: { query: activityCalendarQuerySchema },
      responses: {
        "200": {
          description: "The calendar.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                activityCalendarResponseSchema,
                "ActivityCalendarEnvelope",
              ),
            },
          },
        },
        ...recordRefusal(MODULE_DISABLED_DESCRIPTION),
        ...stdResponses,
      },
    },
  },
  "/api/activity/goals": {
    get: {
      tags: ["Measurements"],
      summary: "Activity goals",
      description:
        "The person's own activity goals: workouts, active minutes and steps per week, steps per month. `null` = not set; there is no default. Owner only; a delegate reads the goals inside the calendar.",
      responses: {
        "200": {
          description: "The goals.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                activityGoalsResponseSchema,
                "ActivityGoalsEnvelope",
              ),
            },
          },
        },
        ...stdResponses,
      },
    },
    patch: {
      tags: ["Measurements"],
      summary: "Set activity goals",
      description:
        "Sets the goals the body names and keeps the rest; `null` clears a goal. Owner only: a shared or delegated session cannot change another person's goals.",
      requestBody: {
        required: true,
        content: { "application/json": { schema: activityGoalsPatch } },
      },
      responses: {
        "200": {
          description: "The goals after the change.",
          content: {
            "application/json": {
              schema: dataEnvelope(
                activityGoalsResponseSchema,
                "ActivityGoalsPatchEnvelope",
              ),
            },
          },
        },
        ...stdResponses,
        ...recordWriteRateLimitResponse,
      },
    },
  },
};
