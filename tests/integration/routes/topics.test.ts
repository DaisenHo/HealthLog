/**
 * `/api/topics` and `/api/topics/{topic}` — the topic pages (preview), against
 * the real database and through the real API kit.
 *
 * Pinned here:
 *   - the preview is the VIEWER's opt-in: off answers 404
 *     `topics.preview_off` on both routes, for the owner and for a delegate
 *     whose own switch is off while the owner's is on;
 *   - the overview gives a topic a tile only when the record holds data for
 *     it, names the offered empty topics and the module-hidden ones, and
 *     follows the record's module switches (cycle without the cycle module);
 *   - a topic page reads the stored values: the latest reading with its usual
 *     range, a relationship once fourteen paired days exist and its count
 *     below that, the lab trend from three readings spanning a year and the
 *     honest "not yet" below it;
 *   - a switched-off module removes its topic (404 `topics.not_available`)
 *     and its signal from every other topic; an unknown topic is 404
 *     `topics.not_found`, an unknown range 422;
 *   - a delegate holding the whole record reads the owner's topics, a grant
 *     scoped to one section is refused, a wildcard Bearer is admitted and a
 *     narrow one is not;
 *   - `/api/auth/me` publishes the viewer's own opt-in as `previewFeatures`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET as getMe } from "@/app/api/auth/me/route";
import { PATCH as patchPreview } from "@/app/api/settings/preview-features/route";
import { GET as getDetail } from "@/app/api/topics/[topic]/route";
import { GET as getOverview } from "@/app/api/topics/route";
import type { MeasurementType } from "@/generated/prisma/enums";
import type { TopicDetail, TopicOverview } from "@/lib/topics/build";

import { anonymous, callRoute, type RouteAuth } from "../../kit/call-route";
import {
  makeGrant,
  makeMeasurement,
  makeSession,
  makeToken,
  makeUser,
} from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const DAY = 86_400_000;

beforeEach(() => truncateAllTables(prisma));

async function switchOn(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { previewFeaturesJson: { topics: true } },
  });
}

/** One reading a day for `days` days, ending yesterday, valued by `f(i)`. */
async function seedDaily(
  userId: string,
  type: MeasurementType,
  unit: string,
  days: number,
  f: (i: number) => number,
) {
  const now = Date.now();
  await prisma.measurement.createMany({
    data: Array.from({ length: days }, (_, i) => ({
      userId,
      type,
      unit,
      value: f(i),
      measuredAt: new Date(now - (i + 1) * DAY - 2 * 3_600_000),
    })),
  });
}

function overview(auth: RouteAuth, headers?: Record<string, string>) {
  return callRoute<TopicOverview>(getOverview, {
    method: "GET",
    route: "/api/topics",
    auth,
    headers,
  });
}

function detail(
  auth: RouteAuth,
  topic: string,
  range?: string,
  headers?: Record<string, string>,
) {
  return callRoute<TopicDetail>(getDetail, {
    method: "GET",
    route: "/api/topics/{topic}",
    params: { topic },
    query: range ? { range } : undefined,
    auth,
    headers,
  });
}

describe("the preview switch", () => {
  it("refuses an anonymous caller with 401", async () => {
    expect((await overview(anonymous)).status).toBe(401);
  });

  it("answers 404 topics.preview_off on both routes while the switch is off", async () => {
    const owner = await makeUser();
    const auth = await makeSession(owner);
    const a = await overview(auth);
    expect(a.status).toBe(404);
    expect(a.meta?.errorCode).toBe("topics.preview_off");
    const b = await detail(auth, "heart");
    expect(b.status).toBe(404);
    expect(b.meta?.errorCode).toBe("topics.preview_off");
  });

  it("is published on /api/auth/me and moves with the Settings switch", async () => {
    const owner = await makeUser();
    const auth = await makeSession(owner);
    const before = await callRoute<{ previewFeatures: { topics: boolean } }>(
      getMe,
      { method: "GET", route: "/api/auth/me", auth },
    );
    expect(before.status).toBe(200);
    expect(before.data.previewFeatures).toEqual({ topics: false });

    const saved = await callRoute(patchPreview, {
      method: "PATCH",
      route: "/api/settings/preview-features",
      body: { topics: true },
      auth,
    });
    expect(saved.status).toBe(200);

    const after = await callRoute<{ previewFeatures: { topics: boolean } }>(
      getMe,
      { method: "GET", route: "/api/auth/me", auth },
    );
    expect(after.data.previewFeatures).toEqual({ topics: true });
    expect((await overview(auth)).status).toBe(200);
  });
});

describe("GET /api/topics", () => {
  it("names every offered topic as empty on a fresh record and hides cycle without its module", async () => {
    const owner = await makeUser();
    await switchOn(owner.id);
    const res = await overview(await makeSession(owner));
    expect(res.status).toBe(200);
    expect(res.data.topics).toEqual([]);
    expect(res.data.hiddenByModule).toEqual(["cycle"]);
    expect(res.data.empty).toContain("heart");
    expect(res.data.empty).not.toContain("cycle");
  });

  it("gives a tile to a topic with data, with its headline and sparkline", async () => {
    const owner = await makeUser();
    await switchOn(owner.id);
    await seedDaily(owner.id, "WEIGHT", "kg", 20, (i) => 80 + (i % 3) * 0.1);
    const res = await overview(await makeSession(owner));
    expect(res.status).toBe(200);
    const body = res.data.topics.find((t) => t.key === "body");
    expect(body).toBeDefined();
    expect(body!.headline).toMatchObject({ kind: "signal", key: "WEIGHT" });
    expect(body!.sparkline.length).toBeGreaterThanOrEqual(19);
    expect(body!.recorded).toBe(1);
    expect(res.data.empty).toContain("heart");
  });

  it("follows the record's module switches", async () => {
    const owner = await makeUser({
      modulePreferencesJson: { sleep: false, mood: false, mentalHealth: false },
    });
    await switchOn(owner.id);
    const res = await overview(await makeSession(owner));
    expect(res.data.hiddenByModule).toEqual(
      expect.arrayContaining(["sleep", "mind", "cycle"]),
    );
  });
});

describe("GET /api/topics/{topic}", () => {
  it("reads the latest value, its usual range and a relationship once 14 days pair", async () => {
    const owner = await makeUser();
    await switchOn(owner.id);
    await seedDaily(
      owner.id,
      "RESTING_HEART_RATE",
      "bpm",
      30,
      (i) => 55 + (i % 10),
    );
    await seedDaily(
      owner.id,
      "HEART_RATE_VARIABILITY",
      "ms",
      30,
      (i) => 80 - (i % 10) * 3,
    );
    const res = await detail(await makeSession(owner), "heart", "30d");
    expect(res.status).toBe(200);
    expect(res.data.key).toBe("heart");
    expect(res.data.range).toBe("30d");
    const rhr = res.data.signals.find((s) => s.key === "RESTING_HEART_RATE");
    expect(rhr?.latest).not.toBeNull();
    expect(rhr?.usual).not.toBeNull();
    expect(rhr?.href).toBe("/insights/resting-pulse");
    const pair = res.data.relationships.find((r) => r.id === "hrv-resting-hr");
    expect(pair).toMatchObject({ status: "linked", pairedDays: 30 });
    expect(pair!.r).toBeLessThan(-0.9);
    expect(res.data.missing).toContain("VO2_MAX");
    expect(res.data.status).toBe("partial");
    expect(res.data.series.map((s) => s.key)).toContain("RESTING_HEART_RATE");
  });

  it("states a pair below 14 paired days with its count and no figure", async () => {
    const owner = await makeUser();
    await switchOn(owner.id);
    await seedDaily(owner.id, "RESTING_HEART_RATE", "bpm", 10, (i) => 58 + i);
    await seedDaily(
      owner.id,
      "HEART_RATE_VARIABILITY",
      "ms",
      10,
      (i) => 70 - i,
    );
    const res = await detail(await makeSession(owner), "heart");
    const pair = res.data.relationships.find((r) => r.id === "hrv-resting-hr");
    expect(pair).toMatchObject({
      status: "insufficient",
      pairedDays: 10,
      requiredDays: 14,
      r: null,
      points: [],
    });
  });

  it("carries the lab trend from three readings over a year, and says when there are fewer", async () => {
    const owner = await makeUser();
    await switchOn(owner.id);
    const ldl = await prisma.biomarker.create({
      data: {
        userId: owner.id,
        name: "LDL",
        unit: "mg/dL",
        lowerBound: 0,
        upperBound: 130,
      },
    });
    const vitd = await prisma.biomarker.create({
      data: {
        userId: owner.id,
        name: "Vitamin D",
        unit: "ng/mL",
        lowerBound: 30,
        upperBound: 100,
      },
    });
    const now = Date.now();
    for (const [biomarker, value, daysAgo] of [
      [ldl, 140, 800],
      [ldl, 120, 400],
      [ldl, 98, 20],
      [vitd, 24, 30],
    ] as const) {
      await prisma.labResult.create({
        data: {
          userId: owner.id,
          biomarkerId: biomarker.id,
          analyte: biomarker.name,
          unit: biomarker.unit,
          value,
          takenAt: new Date(now - daysAgo * DAY),
        },
      });
    }
    const res = await detail(await makeSession(owner), "metabolism");
    expect(res.status).toBe(200);
    expect(res.data.labs).not.toBeNull();
    const byName = new Map(res.data.labs!.markers.map((m) => [m.name, m]));
    expect(byName.get("LDL")?.trend.status).toBe("ok");
    expect(byName.get("Vitamin D")).toMatchObject({
      status: "below",
      trend: { status: "insufficient", n: 1 },
    });
    expect(res.data.summary.code).toBe("labs");
  });

  it("takes a switched-off module's topic away and its signal out of the others", async () => {
    const owner = await makeUser({ modulePreferencesJson: { sleep: false } });
    await switchOn(owner.id);
    await seedDaily(owner.id, "RESTING_HEART_RATE", "bpm", 20, () => 58);
    await makeMeasurement(owner, {
      type: "SLEEP_DURATION",
      unit: "min",
      value: 420,
      measuredAt: new Date(Date.now() - DAY),
    });
    const auth = await makeSession(owner);
    const sleep = await detail(auth, "sleep");
    expect(sleep.status).toBe(404);
    expect(sleep.meta?.errorCode).toBe("topics.not_available");
    const heart = await detail(auth, "heart");
    expect(heart.status).toBe(200);
    expect(heart.data.series.map((s) => s.key)).not.toContain("SLEEP_DURATION");
    expect(
      heart.data.relationships.some(
        (r) => r.x === "SLEEP_DURATION" || r.y === "SLEEP_DURATION",
      ),
    ).toBe(false);
  });

  it("answers 404 for a name that is not a topic and 422 for an unknown range", async () => {
    const owner = await makeUser();
    await switchOn(owner.id);
    const auth = await makeSession(owner);
    const unknown = await callRoute(getDetail, {
      method: "GET",
      route: "/api/topics/{topic}",
      params: { topic: "kidneys" },
      auth,
      contract: { skip: "a path value outside the published enum, on purpose" },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.meta?.errorCode).toBe("topics.not_found");
    const range = await detail(auth, "heart", "2y");
    expect(range.status).toBe(422);
  });
});

describe("who may read the topics", () => {
  async function switchedDelegate(scopeJson: string[] | null) {
    const owner = await makeUser();
    const delegate = await makeUser();
    await seedDaily(owner.id, "WEIGHT", "kg", 15, () => 80);
    await makeGrant(owner, delegate, scopeJson ? { scopeJson } : {});
    const auth = await makeSession(delegate);
    const switched = await prisma.session.update({
      where: { id: auth.sessionId },
      data: { actingAsUserId: owner.id },
    });
    return {
      owner,
      delegate,
      auth,
      headers: {
        "x-healthlog-record-epoch": String(switched.recordEpoch),
        "x-healthlog-record-scope": owner.id,
      },
    };
  }

  it("follows the delegate's own switch, not the owner's", async () => {
    const { owner, auth, headers } = await switchedDelegate(null);
    await switchOn(owner.id);
    const res = await overview(auth, headers);
    expect(res.status).toBe(404);
    expect(res.meta?.errorCode).toBe("topics.preview_off");
  });

  it("shows a whole-record delegate the owner's topics", async () => {
    const { delegate, auth, headers } = await switchedDelegate(null);
    await switchOn(delegate.id);
    const res = await overview(auth, headers);
    expect(res.status).toBe(200);
    expect(res.data.topics.map((t) => t.key)).toContain("body");
  });

  it("refuses a grant scoped to one section", async () => {
    const { delegate, auth, headers } = await switchedDelegate([
      "measurements",
    ]);
    await switchOn(delegate.id);
    expect((await overview(auth, headers)).status).toBe(403);
    expect((await detail(auth, "body", undefined, headers)).status).toBe(403);
  });

  it("admits a wildcard Bearer and refuses a narrow one", async () => {
    const owner = await makeUser();
    await switchOn(owner.id);
    expect((await overview(await makeToken(owner))).status).toBe(200);
    const narrow = await makeToken(owner, { permissions: ["health:read"] });
    expect((await overview(narrow)).status).toBe(403);
  });
});
