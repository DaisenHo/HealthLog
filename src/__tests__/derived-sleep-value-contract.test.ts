/**
 * The published `SleepScoreValue` schema against the value the sleep score
 * engine actually returns, in both shapes a client meets: a scored rhythm,
 * and a rhythm withheld for too few nights (where `gap` appears). A field
 * added to the engine and not to the schema, or the reverse, fails here
 * rather than shipping as a spec that describes a payload nobody sends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    measurement: { findMany: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { prisma } from "@/lib/db";
import { computeSleepScore } from "@/lib/insights/derived/sleep-score";
import { sleepScoreValue } from "@/lib/openapi/routes/insights/schemas";
import { openApiComponents } from "@/lib/openapi/routes";

const findMany = prisma.measurement.findMany as ReturnType<typeof vi.fn>;
const NOW = new Date("2026-10-01T09:00:00Z");
const PROFILE = { ageYears: 40, sex: "MALE" as const };

/** `nights` overnight sessions with stages, the newest ending this morning. */
function rows(nights: number) {
  const out = [];
  for (let i = 0; i < nights; i += 1) {
    const wake = Date.UTC(2026, 9, 1 - i, 6, 0);
    const segs: Array<[string, number]> = [
      ["CORE", 180],
      ["DEEP", 90],
      ["REM", 120],
      ["AWAKE", 20],
      ["CORE", 60],
    ];
    let end = wake - segs.reduce((s, [, m]) => s + m, 0) * 60_000;
    for (const [stage, minutes] of segs) {
      end += minutes * 60_000;
      out.push({
        value: minutes,
        measuredAt: new Date(end),
        sleepStage: stage,
        source: "OURA",
        deviceType: null,
      });
    }
  }
  return out.sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
}

function expectExactShape(value: unknown) {
  const parsed = sleepScoreValue.safeParse(value);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(Object.keys(sleepScoreValue.shape).sort()).toEqual(
    Object.keys(value as Record<string, unknown>).sort(),
  );
}

beforeEach(() => {
  findMany.mockReset();
});

describe("published SleepScoreValue", () => {
  it("is registered as a component even though nothing $refs it", () => {
    expect(openApiComponents.schemas?.SleepScoreValue).toBe(sleepScoreValue);
  });

  it("matches a scored night field for field", async () => {
    findMany.mockResolvedValue(rows(10));
    const derived = await computeSleepScore("u1", PROFILE, {
      now: NOW,
      tz: "UTC",
      priorityJson: null,
    });
    expect(derived.status).toBe("ok");
    if (derived.status !== "ok") return;
    expectExactShape(derived.value);
    expect(derived.value.subScores.every((s) => s.gap === undefined)).toBe(
      true,
    );
  });

  it("matches a withheld rhythm, gap included", async () => {
    findMany.mockResolvedValue(rows(2));
    const derived = await computeSleepScore("u1", PROFILE, {
      now: NOW,
      tz: "UTC",
      priorityJson: null,
    });
    expect(derived.status).toBe("ok");
    if (derived.status !== "ok") return;
    expectExactShape(derived.value);
    expect(
      derived.value.subScores.find((s) => s.key === "consistency")?.gap,
    ).toBe("few_nights");
  });
});
