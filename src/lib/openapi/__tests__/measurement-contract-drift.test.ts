import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { measurementPaths } from "../routes/measurements";
import { workoutPaths } from "../routes/workouts";

/**
 * Contract guard: the documented request / response shapes must match what the
 * handlers actually put on the wire.
 *
 * The fixtures below are transcribed from the handler return statements, not
 * from the schemas — so a schema that drifts away from the handler fails here
 * rather than shipping a spec the iOS client generates the wrong model from.
 *
 * Sources:
 *  - src/app/api/measurements/route.ts — the seven `apiSuccess` returns on GET
 *    (every one of them `{ measurements, meta: { total, limit, offset, … } }`),
 *    the array-body branch on POST, and the 409 duplicate arm.
 *  - src/app/api/workouts/route.ts + src/app/api/workouts/[id]/route.ts —
 *    `requireModuleEnabled(user.id, "workouts")`, which answers 403 with
 *    `meta.errorCode = "module.disabled"`.
 */

/** Pull the Zod schema out of a registered response entry. */
function responseSchema(
  paths: typeof measurementPaths,
  path: string,
  method: "get" | "post",
  status: string,
): z.ZodType {
  const responses = paths[path]?.[method]?.responses as
    | Record<
        string,
        { content?: Record<string, { schema?: unknown }> } | undefined
      >
    | undefined;
  const schema = responses?.[status]?.content?.["application/json"]?.schema;
  if (!schema) {
    throw new Error(`no ${method.toUpperCase()} ${path} ${status} schema`);
  }
  return schema as z.ZodType;
}

function requestSchema(
  paths: typeof measurementPaths,
  path: string,
  method: "post",
): z.ZodType {
  const operation = paths[path]?.[method];
  const schema = operation?.requestBody?.content?.["application/json"]?.schema;
  if (!schema)
    throw new Error(`no ${method.toUpperCase()} ${path} body schema`);
  return schema as z.ZodType;
}

const listResponse = responseSchema(
  measurementPaths,
  "/api/measurements",
  "get",
  "200",
);

describe("GET /api/measurements — documented response matches the handler", () => {
  it("accepts the default paged envelope (route.ts `{ measurements, meta }`)", () => {
    const wire = {
      data: {
        measurements: [
          {
            id: "cm000000000000000000000",
            userId: "cm111111111111111111111",
            type: "WEIGHT",
            value: 80.5,
            unit: "kg",
            source: "MANUAL",
            measuredAt: "2026-07-19T08:00:00.000Z",
            notes: null,
            valueMin: null,
            valueMax: null,
            externalId: null,
            externalSourceVersion: null,
            glucoseContext: null,
            sleepStage: null,
            rhythmClassification: null,
            deviceType: null,
            syncVersion: 1,
            deletedAt: null,
            createdAt: "2026-07-19T08:00:00.000Z",
            updatedAt: "2026-07-19T08:00:00.000Z",
          },
        ],
        meta: { total: 1, limit: 50, offset: 0 },
      },
      error: null,
    };
    expect(listResponse.safeParse(wire).success).toBe(true);
  });

  it("rejects the old `{ measurements, total }` envelope the spec used to claim", () => {
    const stale = {
      data: { measurements: [], total: 0 },
      error: null,
    };
    expect(listResponse.safeParse(stale).success).toBe(false);
  });

  it("accepts the collapsed day-sum mode (dayKey / sampleCount)", () => {
    const wire = {
      data: {
        measurements: [
          {
            id: "day:ACTIVITY_STEPS:2026-07-18",
            type: "ACTIVITY_STEPS",
            value: 9000,
            unit: "steps",
            source: "APPLE_HEALTH",
            measuredAt: "2026-07-18T12:00:00.000Z",
            notes: null,
            dayKey: "2026-07-18",
            sampleCount: 12,
          },
        ],
        meta: {
          total: 1,
          limit: 50,
          offset: 0,
          groupBy: "day",
          droppedDuplicates: 3,
        },
      },
      error: null,
    };
    expect(listResponse.safeParse(wire).success).toBe(true);
  });

  it("accepts the aggregate mode's pre-folded buckets", () => {
    const wire = {
      data: {
        measurements: [
          {
            type: "PULSE",
            value: 62.5,
            measuredAt: "2026-07-18T00:00:00.000Z",
            count: 240,
          },
        ],
        meta: { total: 1, limit: 400, offset: 0, aggregate: "daily" },
      },
      error: null,
    };
    expect(listResponse.safeParse(wire).success).toBe(true);
  });

  it("accepts the per-night collapse mode", () => {
    const wire = {
      data: {
        measurements: [
          {
            id: "sleep-seg:2026-07-18:0",
            type: "SLEEP_DURATION",
            value: 430,
            unit: "minutes",
            source: "APPLE_HEALTH",
            measuredAt: "2026-07-18T06:10:00.000Z",
            sleepStage: "ASLEEP_CORE",
            notes: null,
          },
        ],
        meta: { total: 1, limit: 50, offset: 0, groupBy: "night" },
      },
      error: null,
    };
    expect(listResponse.safeParse(wire).success).toBe(true);
  });
});

describe("POST /api/measurements — documented body + statuses match the handler", () => {
  const body = requestSchema(measurementPaths, "/api/measurements", "post");
  const created = responseSchema(
    measurementPaths,
    "/api/measurements",
    "post",
    "201",
  );

  const single = {
    type: "PULSE",
    value: 61,
    unit: "bpm",
    measuredAt: "2026-07-19T08:00:00.000Z",
  };

  it("accepts the single-object body", () => {
    expect(body.safeParse(single).success).toBe(true);
  });

  it("accepts the ARRAY body the handler branches on (route.ts `Array.isArray(body)`)", () => {
    // The combined blood-pressure write — the reason the array branch exists.
    const systolic = {
      type: "BLOOD_PRESSURE_SYS",
      value: 122,
      unit: "mmHg",
      measuredAt: "2026-07-19T08:00:00.000Z",
    };
    const diastolic = { ...systolic, type: "BLOOD_PRESSURE_DIA", value: 78 };
    expect(body.safeParse([systolic, diastolic]).success).toBe(true);
  });

  it("accepts an array of created rows on 201, matching the array branch", () => {
    const wire = {
      data: [
        {
          id: "cm000000000000000000000",
          type: "PULSE",
          value: 61,
          unit: "bpm",
          source: "MANUAL",
          measuredAt: "2026-07-19T08:00:00.000Z",
          notes: null,
        },
      ],
      error: null,
    };
    expect(created.safeParse(wire).success).toBe(true);
  });

  it("documents the 409 the duplicate-dedup arm returns", () => {
    const responses = measurementPaths["/api/measurements"]?.post?.responses;
    expect(Object.keys(responses ?? {})).toContain("409");
  });
});

describe("workouts — the module gate's 403 is documented", () => {
  it.each(["/api/workouts", "/api/workouts/{id}"])(
    "GET %s declares 403",
    (path) => {
      const responses = workoutPaths[path]?.get?.responses;
      expect(Object.keys(responses ?? {})).toContain("403");
      expect(responses?.["403"]?.description).toContain("module.disabled");
    },
  );

  it("leaves the deliberately ungated batch ingest without a module 403", () => {
    // src/app/api/workouts/batch/route.ts runs no `requireModuleEnabled` —
    // synced data still lands while the surface is hidden.
    const responses = workoutPaths["/api/workouts/batch"]?.post?.responses;
    expect(Object.keys(responses ?? {})).not.toContain("403");
  });
});
