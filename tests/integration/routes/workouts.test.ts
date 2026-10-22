/**
 * `GET` and `DELETE /api/workouts/{id}`, against the real database, through
 * the real API kit, with the personal-records re-derivation queued on a real
 * pg-boss queue.
 *
 * The read, pinned here:
 *   - answers the caller's own workout under the native client's field
 *     names, and 404 for another account's row or a missing one; 401 without
 *     a session, 403 `module.disabled` while the workouts module is off;
 *   - `canonicalId` names the cluster winner (the Apple Health twin when the
 *     Withings sibling was asked for), the winner borrows heart rate and
 *     zones only where it has none of its own, and `previousWorkoutId` is the
 *     canonical session before this one, never a twin of it;
 *   - `dayKey` is the session's day in the account's timezone;
 *   - the route geometry, the stored heart-rate series, zones, splits and
 *     sport context; `compact=1` drops the raw sample and timestamp blobs; a
 *     sealed track reads exactly like a readable one and wins over a readable
 *     column on the same row;
 *   - `aiInsight` serves the stored paragraph while `workoutInsights` is
 *     available, null when none is stored or the paragraph cannot be
 *     decrypted, and never while the capability is unavailable, with `ai`
 *     naming the reason.
 *
 * The delete, pinned here:
 *   - removes a workout entered by hand, with the personal records it set,
 *     leaves an audit row, and queues a silent detection pass when a record
 *     went; a legacy record without an external id goes only when it is this
 *     sport's and set at this workout's start;
 *   - a synced workout is 409 `workout.delete.synced_source` and nothing is
 *     touched; another account's row and a missing row are 404; anonymous is
 *     401 and a narrow token is 403.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgBoss } from "pg-boss";

import { Prisma, type User, type Workout } from "@/generated/prisma/client";
import { DELETE, GET } from "@/app/api/workouts/[id]/route";
import { setGlobalBoss } from "@/lib/jobs/boss-instance";
import { PR_DETECTION_QUEUE } from "@/lib/jobs/pr-detection";
import { encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import { encryptRouteGeometry } from "@/lib/workouts/route-geometry-cipher";

import { anonymous, callRoute, type RouteAuth } from "../../kit/call-route";
import {
  makeSession,
  makeToken,
  makeUser,
  makeWorkout,
} from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/workouts/{id}";
const DAY_MS = 24 * 60 * 60 * 1000;

let boss: PgBoss;

beforeAll(async () => {
  boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  await boss.start();
  await boss.createQueue(PR_DETECTION_QUEUE);
  setGlobalBoss(boss);
}, 120_000);

afterAll(async () => {
  setGlobalBoss(null);
  await boss?.stop({ graceful: false });
});

beforeEach(() => truncateAllTables(prisma));

/**
 * Ten days back: the heart-rate curve's pulse-window fallback only reaches
 * inside the dense-intraday retention horizon, so a fixed calendar day would
 * age out of it.
 */
const SESSION_DAY = new Date(Date.now() - 10 * DAY_MS)
  .toISOString()
  .slice(0, 10);
const START = new Date(`${SESSION_DAY}T07:00:00Z`);
const END = new Date(`${SESSION_DAY}T07:30:00Z`);

const GEOMETRY = {
  type: "LineString",
  coordinates: [
    [11.0, 49.0],
    [11.005, 49.0],
    [11.01, 49.0],
  ],
};
const TIMESTAMPS = [
  `${SESSION_DAY}T07:00:00Z`,
  `${SESSION_DAY}T07:02:00Z`,
  `${SESSION_DAY}T07:04:00Z`,
];

interface Detail {
  id: string;
  dayKey: string;
  durationSec: number;
  distanceM: number | null;
  activeEnergyKcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  source: string;
  metadata: unknown;
  route: { geometry: unknown; sampleTimestamps: unknown } | null;
  samples: { sampleCount: number; samples: unknown } | null;
  hrSeries: { source: string; points: unknown[] } | null;
  zones: { model: string } | null;
  splits: unknown;
  sportContext: unknown;
  aiInsight: { paragraph: string; generatedAt: string } | null;
  ai: { available: boolean; reason: string | null; onDeviceAllowed: boolean };
  canonicalId: string;
  previousWorkoutId: string | null;
}

function appleRun(
  user: Pick<User, "id">,
  overrides: Partial<Omit<Prisma.WorkoutUncheckedCreateInput, "userId">> = {},
): Promise<Workout> {
  return makeWorkout(user, {
    sportType: "running",
    startedAt: START,
    endedAt: END,
    durationSec: 1800,
    totalDistanceM: 5000,
    totalEnergyKcal: 320,
    avgHeartRate: 145,
    maxHeartRate: 170,
    minHeartRate: 110,
    stepCount: 5800,
    elevationM: 12.5,
    source: "APPLE_HEALTH",
    externalId: `ext-${Math.random().toString(36).slice(2)}`,
    metadata: { hkVersion: "1" },
    ...overrides,
  });
}

async function read(
  workoutId: string,
  auth: RouteAuth,
  query: Record<string, string> = {},
) {
  return callRoute<Detail>(GET, {
    method: "GET",
    route: ROUTE,
    params: { id: workoutId },
    query,
    auth,
  });
}

/** An account for which `workoutInsights` is available: own key and receipt. */
async function makeAiUser(
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const user = await makeUser({
    aiProvider: "ANTHROPIC",
    aiModel: "claude-sonnet-4-6",
    // Presence only: the capability probe never decrypts.
    aiAnthropicKeyEncrypted: "v1:presence-only",
    locale: "en",
    ...overrides,
  });
  await prisma.consentReceipt.create({
    data: {
      userId: user.id,
      kind: "ai_full",
      artefact: "test",
      signedAt: new Date(),
    },
  });
  return user;
}

describe("GET /api/workouts/{id}", () => {
  it("returns the caller's workout under the native client's field names", async () => {
    const user = await makeUser();
    const workout = await appleRun(user);

    const res = await read(workout.id, await makeSession(user));

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      id: workout.id,
      distanceM: 5000,
      activeEnergyKcal: 320,
      avgHr: 145,
      maxHr: 170,
      canonicalId: workout.id,
      route: null,
      // Nothing older on record: absence, not a link to nowhere.
      previousWorkoutId: null,
    });
  });

  it("points previousWorkoutId at the canonical session before this one, never at a twin", async () => {
    const user = await makeUser();
    const workout = await appleRun(user);
    const fiveDaysBefore = new Date(START.getTime() - 5 * DAY_MS);
    const previous = await appleRun(user, {
      startedAt: fiveDaysBefore,
      endedAt: new Date(fiveDaysBefore.getTime() + 1800_000),
    });
    // The same session as seen by a second device, a minute later.
    await appleRun(user, {
      source: "WITHINGS",
      startedAt: new Date(fiveDaysBefore.getTime() + 60_000),
      endedAt: new Date(fiveDaysBefore.getTime() + 1860_000),
    });
    const older = new Date(START.getTime() - 8 * DAY_MS);
    await appleRun(user, {
      startedAt: older,
      endedAt: new Date(older.getTime() + 1800_000),
    });

    const res = await read(workout.id, await makeSession(user));

    expect(res.status).toBe(200);
    expect(res.data.previousWorkoutId).toBe(previous.id);
  });

  it("dates the session by the account's timezone, not by UTC", async () => {
    // 20:00 UTC is already the next calendar day in Auckland.
    const user = await makeUser({ timezone: "Pacific/Auckland" });
    const workout = await appleRun(user, {
      startedAt: new Date(`${SESSION_DAY}T20:00:00Z`),
      endedAt: new Date(`${SESSION_DAY}T20:30:00Z`),
    });

    const res = await read(workout.id, await makeSession(user));

    expect(res.status).toBe(200);
    const nextDay = new Date(
      new Date(`${SESSION_DAY}T00:00:00Z`).getTime() + DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    expect(res.data.dayKey).toBe(nextDay);
  });

  it("fills the Apple winner's missing heart rate and zones from its WHOOP twin, and nothing else", async () => {
    const user = await makeUser();
    const apple = await appleRun(user, {
      avgHeartRate: null,
      maxHeartRate: null,
      metadata: { hkVersion: "1", owner: "apple" },
    });
    await prisma.workoutRoute.create({
      data: { workoutId: apple.id, geometry: GEOMETRY },
    });
    await appleRun(user, {
      source: "WHOOP",
      startedAt: new Date(START.getTime() + 30_000),
      endedAt: new Date(END.getTime() + 30_000),
      avgHeartRate: 148,
      maxHeartRate: 181,
      metadata: {
        zoneDurations: { zone_one_milli: 60_000, zone_two_milli: 300_000 },
        whoopWorkoutStrain: 12.3,
      },
    });

    const res = await read(apple.id, await makeSession(user));

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      id: apple.id,
      source: "APPLE_HEALTH",
      canonicalId: apple.id,
      avgHr: 148,
      maxHr: 181,
      route: { geometry: GEOMETRY },
      metadata: { hkVersion: "1", owner: "apple" },
    });
    expect(res.data.metadata).not.toHaveProperty("whoopWorkoutStrain");
    expect(res.data.metadata).not.toHaveProperty("zoneDurations");
    expect(res.data.zones?.model).toBe("whoop");
    expect(res.data.hrSeries).toBeNull();
  });

  it("keeps the winner's own heart rate when its twin carries different values", async () => {
    const user = await makeUser();
    const apple = await appleRun(user);
    await appleRun(user, {
      source: "WHOOP",
      startedAt: new Date(START.getTime() + 30_000),
      endedAt: new Date(END.getTime() + 30_000),
      avgHeartRate: 155,
      maxHeartRate: 190,
      metadata: Prisma.JsonNull,
    });

    const res = await read(apple.id, await makeSession(user));

    expect(res.data.avgHr).toBe(145);
    expect(res.data.maxHr).toBe(170);
  });

  it("returns 401 without a session", async () => {
    const user = await makeUser();
    const workout = await appleRun(user);

    const res = await read(workout.id, anonymous);

    expect(res.status).toBe(401);
    expect(res.meta?.errorCode).toBe("auth.missing");
  });

  it("returns 403 module.disabled while the workouts module is off", async () => {
    const user = await makeUser({ modulePreferencesJson: { workouts: false } });
    const workout = await appleRun(user);

    const res = await read(workout.id, await makeSession(user));

    expect(res.status).toBe(403);
    expect(res.meta?.errorCode).toBe("module.disabled");
    expect(res.meta?.module).toBe("workouts");
  });

  it("returns 404 for another account's workout", async () => {
    const owner = await makeUser();
    const workout = await appleRun(owner);

    const res = await read(workout.id, await makeSession(await makeUser()));

    expect(res.status).toBe(404);
    expect(res.data).toBeNull();
  });

  it("returns 404 when no such workout exists", async () => {
    const res = await read(
      "no-such-workout",
      await makeSession(await makeUser()),
    );

    expect(res.status).toBe(404);
  });

  it("resolves canonicalId to the Apple Health twin when the Withings sibling is asked for", async () => {
    const user = await makeUser();
    const apple = await appleRun(user);
    const withings = await appleRun(user, { source: "WITHINGS" });

    const res = await read(withings.id, await makeSession(user));

    expect(res.status).toBe(200);
    expect(res.data.id).toBe(withings.id);
    expect(res.data.canonicalId).toBe(apple.id);
  });

  it("adds the stored series, device zones, splits and sport context, and drops the raw blobs under compact=1", async () => {
    const user = await makeUser();
    const storedSamples = Array.from({ length: 40 }, (_, i) => ({
      t: new Date(START.getTime() + i * 45_000).toISOString(),
      hr: 140 + (i % 6),
    }));
    const workout = await appleRun(user, {
      // WHOOP device zones win, so zones render without a profile age.
      metadata: {
        zoneDurations: {
          zone_one_milli: 60_000,
          zone_two_milli: 300_000,
          zone_three_milli: 600_000,
          zone_four_milli: 200_000,
          zone_five_milli: 40_000,
        },
      },
    });
    await prisma.workoutRoute.create({
      data: {
        workoutId: workout.id,
        geometry: GEOMETRY,
        sampleTimestamps: TIMESTAMPS,
      },
    });
    await prisma.workoutSamples.create({
      data: {
        workoutId: workout.id,
        samples: storedSamples,
        sampleCount: storedSamples.length,
      },
    });

    const res = await read(workout.id, await makeSession(user), {
      compact: "1",
    });

    expect(res.status).toBe(200);
    expect(res.data.hrSeries?.source).toBe("workout_series");
    expect(res.data.hrSeries?.points.length).toBeGreaterThanOrEqual(2);
    expect(res.data.zones?.model).toBe("whoop");
    expect(res.data).toHaveProperty("splits");
    expect(res.data).toHaveProperty("sportContext");
    expect(res.data.aiInsight).toBeNull();
    expect(res.data.samples).toEqual({ sampleCount: 40, samples: null });
    expect(res.data.route?.geometry).toEqual(GEOMETRY);
    expect(res.data.route?.sampleTimestamps).toBeNull();
  });

  it("exposes the route geometry and its timestamps without compact", async () => {
    const user = await makeUser();
    const workout = await appleRun(user);
    await prisma.workoutRoute.create({
      data: {
        workoutId: workout.id,
        geometry: GEOMETRY,
        sampleTimestamps: TIMESTAMPS,
      },
    });

    const res = await read(workout.id, await makeSession(user));

    expect(res.data.route).toEqual({
      geometry: GEOMETRY,
      sampleTimestamps: TIMESTAMPS,
    });
  });

  it("serves a sealed track in the same shape as a readable one, splits included", async () => {
    const user = await makeUser();
    const session = await makeSession(user);
    const readable = await appleRun(user);
    await prisma.workoutRoute.create({
      data: {
        workoutId: readable.id,
        geometry: GEOMETRY,
        sampleTimestamps: TIMESTAMPS,
      },
    });
    const otherDay = new Date(START.getTime() - 2 * DAY_MS);
    const sealed = await appleRun(user, {
      startedAt: otherDay,
      endedAt: new Date(otherDay.getTime() + 1800_000),
    });
    await prisma.workoutRoute.create({
      data: {
        workoutId: sealed.id,
        geometryEncrypted: encryptRouteGeometry(GEOMETRY),
        sampleTimestamps: TIMESTAMPS,
      },
    });

    const legacy = await read(readable.id, session);
    const fromCipher = await read(sealed.id, session);

    expect(fromCipher.data.route).toEqual(legacy.data.route);
    expect(fromCipher.data.route?.geometry).toEqual(GEOMETRY);
    expect(fromCipher.data.splits).toEqual(legacy.data.splits);
  });

  it("prefers the sealed track over a readable column on the same row", async () => {
    const user = await makeUser();
    const workout = await appleRun(user);
    await prisma.workoutRoute.create({
      data: {
        workoutId: workout.id,
        geometry: { type: "LineString", coordinates: [[0, 0]] },
        geometryEncrypted: encryptRouteGeometry(GEOMETRY),
        sampleTimestamps: TIMESTAMPS,
      },
    });

    const res = await read(workout.id, await makeSession(user));

    expect(res.data.route?.geometry).toEqual(GEOMETRY);
  });
});

describe("GET /api/workouts/{id}: aiInsight", () => {
  async function withInsight(
    user: Pick<User, "id">,
    paragraphEncrypted: Uint8Array<ArrayBuffer>,
    generatedAt = new Date(`${SESSION_DAY}T07:35:00Z`),
  ): Promise<Workout> {
    const workout = await appleRun(user);
    await prisma.workoutInsight.create({
      data: {
        userId: user.id,
        workoutId: workout.id,
        paragraphEncrypted,
        inputHash: "hash",
        promptVersion: "v1",
        providerType: "anthropic",
        locale: "en",
        generatedAt,
      },
    });
    return workout;
  }

  function sealed(text: string): Uint8Array<ArrayBuffer> {
    return encryptToBytes(text);
  }

  it("serves null when the workout has no stored paragraph", async () => {
    const user = await makeAiUser();
    const workout = await appleRun(user);

    const res = await read(workout.id, await makeSession(user), {
      compact: "1",
    });

    expect(res.status).toBe(200);
    expect(res.data.ai.available).toBe(true);
    expect(res.data.aiInsight).toBeNull();
  });

  it("serves the decrypted paragraph while workoutInsights is available", async () => {
    const user = await makeAiUser();
    const generatedAt = new Date(`${SESSION_DAY}T07:35:00Z`);
    const workout = await withInsight(
      user,
      sealed("A steady, aerobic-leaning run."),
      generatedAt,
    );

    const res = await read(workout.id, await makeSession(user), {
      compact: "1",
    });

    expect(res.data.aiInsight).toEqual({
      paragraph: "A steady, aerobic-leaning run.",
      generatedAt: generatedAt.toISOString(),
    });
    expect(res.data.ai).toEqual({
      available: true,
      reason: null,
      onDeviceAllowed: true,
    });
  });

  it.each([
    [
      "operator_disabled",
      async () => {
        await prisma.appSettings.create({
          data: { id: "singleton", assistantEnabled: false },
        });
        return makeAiUser();
      },
    ],
    [
      "user_disabled",
      () => makeAiUser({ modulePreferencesJson: { insights: false } }),
    ],
    [
      "consent_required",
      async () => {
        await prisma.appSettings.create({
          data: {
            id: "singleton",
            adminAiKeyEncrypted: "v1:presence-only",
            adminAiModel: "gpt-4o",
          },
        });
        return makeUser({ locale: "en" });
      },
    ],
    ["no_provider", () => makeUser({ locale: "en" })],
  ] as const)(
    "does not serve the stored paragraph while workoutInsights is %s",
    async (reason, arrange) => {
      const user = await arrange();
      const workout = await withInsight(user, sealed("Model-written."));

      const res = await read(workout.id, await makeSession(user), {
        compact: "1",
      });

      expect(res.status).toBe(200);
      expect(res.data.aiInsight).toBeNull();
      expect(res.data.ai.available).toBe(false);
      expect(res.data.ai.reason).toBe(reason);
    },
  );

  it("degrades to no paragraph rather than failing the read on an undecryptable row", async () => {
    const user = await makeAiUser();
    const workout = await withInsight(user, new Uint8Array([0, 1, 2, 3]));

    const res = await read(workout.id, await makeSession(user), {
      compact: "1",
    });

    expect(res.status).toBe(200);
    expect(res.data.aiInsight).toBeNull();
    expect(res.data.id).toBe(workout.id);
    expect(res.data.durationSec).toBe(1800);
  });
});

describe("DELETE /api/workouts/{id}", () => {
  async function del(workoutId: string, auth: RouteAuth) {
    return callRoute<{ deleted: true }>(DELETE, {
      method: "DELETE",
      route: ROUTE,
      params: { id: workoutId },
      auth,
    });
  }

  function manualRun(
    user: Pick<User, "id">,
    overrides: Partial<Omit<Prisma.WorkoutUncheckedCreateInput, "userId">> = {},
  ) {
    return appleRun(user, {
      source: "MANUAL",
      externalId: "manual:5b0f3c1e-1111-4222-8333-444455556666",
      ...overrides,
    });
  }

  function record(
    user: Pick<User, "id">,
    overrides: Partial<
      Omit<Prisma.PersonalRecordUncheckedCreateInput, "userId">
    > = {},
  ) {
    return prisma.personalRecord.create({
      data: {
        userId: user.id,
        metricType: "WALKING_RUNNING_DISTANCE",
        metricSlot: "longest_run_duration",
        direction: "MAX",
        value: 1800,
        unit: "s",
        achievedAt: START,
        source: "MANUAL",
        ...overrides,
      },
    });
  }

  async function detectionJobs(userId: string) {
    return prisma.$queryRaw<
      Array<{ data: { userId: string; silent: boolean } }>
    >`
      SELECT data FROM pgboss.job
      WHERE name = ${PR_DETECTION_QUEUE} AND data->>'userId' = ${userId}
    `;
  }

  it("removes a workout entered by hand, audits it, and the next read is 404", async () => {
    const user = await makeUser();
    const session = await makeSession(user);
    const workout = await manualRun(user);

    const res = await del(workout.id, session);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { deleted: true }, error: null });
    expect(
      await prisma.workout.findUnique({ where: { id: workout.id } }),
    ).toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "workout.delete" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details ?? "null")).toMatchObject({
      workoutId: workout.id,
      sportType: "running",
      personalRecordsRemoved: 0,
    });
    expect((await read(workout.id, session)).status).toBe(404);
    // Nothing was removed, so nothing needs re-deriving.
    expect(await detectionJobs(user.id)).toEqual([]);
  });

  it("takes the personal records the workout set with it and queues a silent re-derivation", async () => {
    const user = await makeUser();
    const workout = await manualRun(user);
    const set = await record(user, { externalId: workout.externalId });
    const unrelated = await record(user, {
      externalId: "manual:another-workout",
      achievedAt: new Date(START.getTime() - DAY_MS),
    });

    const res = await del(workout.id, await makeSession(user));

    expect(res.status).toBe(200);
    expect(
      await prisma.personalRecord.findUnique({ where: { id: set.id } }),
    ).toBeNull();
    expect(
      await prisma.personalRecord.findUnique({ where: { id: unrelated.id } }),
    ).not.toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: user.id, action: "workout.delete" },
    });
    expect(JSON.parse(audit.details ?? "null")).toMatchObject({
      personalRecordsRemoved: 1,
    });
    const jobs = await detectionJobs(user.id);
    expect(jobs.map((j) => j.data.silent)).toEqual([true]);
  });

  it("removes a legacy record without an external id only when it is this sport's and set at this start", async () => {
    const user = await makeUser();
    const workout = await manualRun(user, { externalId: null });
    const running = await record(user, { externalId: null });
    // A cycling record set at the same instant is not this workout's.
    const cycling = await record(user, {
      externalId: null,
      metricSlot: "longest_cycle_duration",
    });
    const otherStart = await record(user, {
      externalId: null,
      metricSlot: "longest_distance_run",
      achievedAt: new Date(START.getTime() - DAY_MS),
    });

    const res = await del(workout.id, await makeSession(user));

    expect(res.status).toBe(200);
    const left = await prisma.personalRecord.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    expect(left.map((r) => r.id).sort()).toEqual(
      [cycling.id, otherStart.id].sort(),
    );
    expect(left.map((r) => r.id)).not.toContain(running.id);
  });

  it.each(["APPLE_HEALTH", "WITHINGS", "WHOOP", "EXTERNAL"] as const)(
    "refuses a %s workout with 409 and touches nothing",
    async (source) => {
      const user = await makeUser();
      const workout = await appleRun(user, { source });
      const set = await record(user, {
        source,
        externalId: workout.externalId,
      });

      const res = await del(workout.id, await makeSession(user));

      expect(res.status).toBe(409);
      expect(res.data).toBeNull();
      expect(res.meta?.errorCode).toBe("workout.delete.synced_source");
      expect(
        await prisma.workout.findUnique({ where: { id: workout.id } }),
      ).not.toBeNull();
      expect(
        await prisma.personalRecord.findUnique({ where: { id: set.id } }),
      ).not.toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { userId: user.id, action: "workout.delete" },
        }),
      ).toBe(0);
    },
  );

  it("answers 404 for another account's workout and leaves it in place", async () => {
    const owner = await makeUser();
    const workout = await manualRun(owner);

    const res = await del(workout.id, await makeSession(await makeUser()));

    expect(res.status).toBe(404);
    expect(
      await prisma.workout.findUnique({ where: { id: workout.id } }),
    ).not.toBeNull();
  });

  it("answers 404 when there is no such workout", async () => {
    const res = await del("missing", await makeSession(await makeUser()));

    expect(res.status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const user = await makeUser();
    const workout = await manualRun(user);

    const res = await del(workout.id, anonymous);

    expect(res.status).toBe(401);
    expect(
      await prisma.workout.findUnique({ where: { id: workout.id } }),
    ).not.toBeNull();
  });

  it("refuses a narrow token with 403 and leaves the workout in place", async () => {
    const user = await makeUser();
    const workout = await manualRun(user);

    const res = await del(
      workout.id,
      await makeToken(user, { permissions: ["workouts:write"] }),
    );

    expect(res.status).toBe(403);
    expect(res.meta?.errorCode).toBe("auth.scope.insufficient");
    expect(
      await prisma.workout.findUnique({ where: { id: workout.id } }),
    ).not.toBeNull();
  });
});
