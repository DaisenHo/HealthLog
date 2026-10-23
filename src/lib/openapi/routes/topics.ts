/**
 * OpenAPI route table for the topic pages (preview): `/api/topics` and
 * `/api/topics/{topic}`.
 *
 * Part of the OpenAPI route table; aggregated in `./index.ts`. The request
 * schemas are the routes' own (`@/lib/validations/topics`); the response
 * shapes mirror `src/lib/topics/build.ts` and reuse the published lab-trend,
 * training-load and screener-trend components rather than restating them.
 */
import type { ZodOpenApiObject } from "zod-openapi";
import { z } from "zod/v4";

import { TOPIC_KEYS, TOPIC_RANGES } from "@/lib/topics/registry";
import {
  topicDetailQuerySchema,
  topicPathSchema,
} from "@/lib/validations/topics";

import { biomarkerTrendSchema } from "./biomarkers";
import { assessmentTrendSchema } from "./mental-health";
import {
  dataEnvelope,
  errorEnvelope,
  measurementTypeEnum,
  recordRefusal,
  stdResponses,
} from "./shared";
import { trainingLoadSchema } from "./workouts";

const dayKey = z.string().describe("A local calendar day, `YYYY-MM-DD`.");

const topicKey = z.enum(TOPIC_KEYS).meta({
  id: "TopicKey",
  description: "A topic, as its URL slug.",
});

const signalKey = z.union([measurementTypeEnum, z.literal("MOOD")]).meta({
  id: "TopicSignalKey",
  description:
    "A daily series a topic reads: a `MeasurementType`, or `MOOD` for the day's mean mood score (1 to 5). Values are in the type's stored unit (sleep in minutes asleep per night, keyed by the day the night ended); clients convert for display as they do for the metric pages.",
});

const dayValue = z.object({ day: dayKey, value: z.number() });

const usualRange = z
  .object({
    low: z.number(),
    high: z.number(),
    center: z.number(),
    days: z.number().int().describe("Days the band was built from."),
  })
  .meta({
    id: "TopicUsualRange",
    description:
      "The personal usual range over the trailing 90 days: median ± 3 scaled MAD of the daily values, never narrower than the measurement's own wobble. Needs 7 days, else null.",
  });

const signal = z
  .object({
    key: signalKey,
    latest: dayValue.nullable(),
    usual: usualRange.nullable(),
    state: z
      .enum(["within", "above", "below", "learning", "none"])
      .describe(
        "`latest` against `usual`: `learning` while the range needs more days, `none` without a value.",
      ),
    href: z
      .string()
      .nullable()
      .describe("The in-app single-metric page of this signal."),
  })
  .meta({ id: "TopicSignal" });

const summary = z
  .object({
    code: z.enum([
      "outside",
      "labs",
      "cycleDay",
      "steady",
      "learning",
      "empty",
    ]),
    signal: signalKey.nullable(),
    direction: z.enum(["above", "below"]).nullable(),
    count: z.number().int().nullable(),
    total: z.number().int().nullable(),
  })
  .meta({
    id: "TopicSummary",
    description:
      "The topic's one sentence as a code with parameters, picked by a fixed rule (never model text): `outside` names the first signal outside its usual range and the direction; `labs` counts lab markers inside their window (`count` of `total`); `cycleDay` gives today's cycle day in `count`; `steady` counts signals inside their range (`count` of `total` recorded); `learning` while no range is established; `empty` without any data.",
  });

const headline = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("signal"),
      key: signalKey,
      value: z.number(),
      day: dayKey,
    }),
    z.object({
      kind: z.literal("labs"),
      inRange: z.number().int(),
      total: z.number().int(),
    }),
    z.object({ kind: z.literal("cycleDay"), dayOfCycle: z.number().int() }),
    z.object({
      kind: z.literal("screener"),
      instrument: z.string(),
      score: z.number(),
    }),
  ])
  .meta({ id: "TopicHeadline" });

const overviewEntry = z
  .object({
    key: topicKey,
    headline: headline.nullable(),
    summary,
    tone: z.enum(["steady", "watch", "learning"]),
    sparkline: z
      .array(z.number())
      .describe(
        "The headline signal's daily values over the last 30 days, oldest first; empty when the headline is a block.",
      ),
    recorded: z.number().int(),
    total: z.number().int(),
  })
  .meta({ id: "TopicOverviewEntry" });

const overviewSchema = z
  .object({
    topics: z.array(overviewEntry),
    empty: z
      .array(topicKey)
      .describe("Offered topics with nothing recorded yet."),
    hiddenByModule: z
      .array(topicKey)
      .describe("Topics whose every module is switched off for the record."),
  })
  .meta({ id: "TopicOverview" });

const relationship = z
  .object({
    id: z.string(),
    x: signalKey,
    y: signalKey,
    lagDays: z
      .union([z.literal(0), z.literal(1)])
      .describe("`x` on day d is held against `y` on day d + `lagDays`."),
    kind: z.enum(["correlation", "split"]),
    pairedDays: z.number().int(),
    requiredDays: z
      .number()
      .int()
      .describe("Paired days needed before anything is said: 14."),
    status: z
      .enum(["insufficient", "no_clear_link", "linked"])
      .describe(
        "`linked` only at p < 0.05 (Pearson, or Welch for a split); a pattern, never a cause.",
      ),
    r: z.number().nullable(),
    pValue: z.number().nullable(),
    split: z
      .object({
        threshold: z.number(),
        belowDays: z.number().int(),
        otherDays: z.number().int(),
        belowMean: z.number(),
        otherMean: z.number(),
        difference: z.number(),
      })
      .nullable()
      .describe(
        "For a split: the mean of `y` on days `x` sat below `threshold` against the other days.",
      ),
    points: z
      .array(z.object({ x: z.number(), y: z.number() }))
      .describe(
        "Paired values for a scatter, at most 120; empty when insufficient.",
      ),
  })
  .meta({ id: "TopicRelationship" });

const trend = z
  .object({
    key: signalKey,
    status: z.enum(["ok", "insufficient"]),
    days: z.number().int(),
    change: z
      .number()
      .nullable()
      .describe(
        "The least-squares change across the trailing 90 days, in the stored unit. Needs 14 days.",
      ),
    weekly: z
      .array(dayValue)
      .describe("Weekly means, each keyed by its Monday."),
  })
  .meta({ id: "TopicTrend" });

const labMarker = z
  .object({
    biomarkerId: z.string(),
    name: z.string(),
    unit: z.string(),
    latest: z.number(),
    takenOn: dayKey,
    low: z.number().nullable(),
    high: z.number().nullable(),
    status: z.enum(["in-range", "below", "above", "unknown"]),
    readings: z.number().int(),
    trend: biomarkerTrendSchema,
  })
  .meta({ id: "TopicLabMarker" });

const labPanel = z
  .object({
    markers: z.array(labMarker).describe("At most 24, newest reading first."),
    inRange: z.number().int(),
    withRange: z.number().int(),
    latestOn: dayKey.nullable(),
  })
  .meta({ id: "TopicLabPanel" });

const cycleSummary = z
  .object({
    today: z
      .object({
        dayOfCycle: z.number().int(),
        phase: z.string().nullable(),
      })
      .nullable(),
    lengths: z.array(z.number().int()),
    averageLength: z.number().nullable(),
    periodsLogged: z.number().int(),
  })
  .meta({ id: "TopicCycleSummary" });

const detailSchema = z
  .object({
    key: topicKey,
    range: z.enum(TOPIC_RANGES),
    from: dayKey,
    to: dayKey,
    status: z.enum(["ready", "partial", "empty"]),
    summary,
    signals: z.array(signal),
    series: z.array(
      z.object({
        key: signalKey,
        usual: usualRange.nullable(),
        points: z.array(dayValue),
      }),
    ),
    relationships: z.array(relationship),
    trends: z.array(trend),
    missing: z
      .array(signalKey)
      .describe("Signals the topic could show that hold no value yet."),
    labs: labPanel.nullable(),
    training: trainingLoadSchema.nullable(),
    screeners: z.array(assessmentTrendSchema).nullable(),
    cycle: cycleSummary.nullable(),
  })
  .meta({ id: "TopicDetail" });

const PREVIEW_OFF =
  "`topics.preview_off`: the person reading has not switched the topics preview on (Settings > System > Preview features). The preview is per account and off by default.";

export const topicPaths: NonNullable<ZodOpenApiObject["paths"]> = {
  "/api/topics": {
    get: {
      tags: ["Insights"],
      summary: "Topic overview (preview)",
      description:
        "One entry per topic the record holds data for, with a headline value, a rule-based sentence and a 30-day sparkline, computed from the same daily values the metric pages draw. No model, no AI gate. Topics follow the record's module switches. Reads across sections, so a grant scoped to some of them is refused.",
      responses: {
        "200": {
          description: "The overview.",
          content: {
            "application/json": {
              schema: dataEnvelope(overviewSchema, "TopicOverviewEnvelope"),
            },
          },
        },
        "404": {
          description: PREVIEW_OFF,
          content: { "application/json": { schema: errorEnvelope } },
        },
        ...stdResponses,
        ...recordRefusal(),
      },
    },
  },
  "/api/topics/{topic}": {
    get: {
      tags: ["Insights"],
      summary: "One topic (preview)",
      description:
        "A topic's signals with their usual ranges, the side-by-side series for `range`, relationships between its signals (nothing is said below 14 paired days), 90-day trends, the signals it holds nothing for yet, and its blocks: training load, lab markers with their trend (three readings spanning a year), screener trends, today's cycle day. No model, no AI gate.",
      requestParams: { path: topicPathSchema, query: topicDetailQuerySchema },
      responses: {
        "200": {
          description: "The topic.",
          content: {
            "application/json": {
              schema: dataEnvelope(detailSchema, "TopicDetailEnvelope"),
            },
          },
        },
        "404": {
          description: `${PREVIEW_OFF}\n\n\`topics.not_found\`: no topic by that name. \`topics.not_available\`: the record's module switches do not offer this topic.`,
          content: { "application/json": { schema: errorEnvelope } },
        },
        ...stdResponses,
        ...recordRefusal(),
      },
    },
  },
};
