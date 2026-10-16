/**
 * Mood patterns from the real aggregate read (ios #116 item 6).
 *
 * The note days come from their own projection (`noteEncrypted` or the legacy
 * `note` set, distinct by mood day), so the `notes` pattern is only as right
 * as that query. This seeds a year with a weekend effect and notes on low
 * days, runs `fetchMoodAggregates` against Postgres, and reads the patterns
 * the wire serves for the year and for thirty days.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { getPrismaClient, truncateAllTables } from "./setup";

process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const USER_ID = "user-mood-patterns";

beforeEach(async () => {
  await truncateAllTables(getPrismaClient());
  await getPrismaClient().user.create({
    data: {
      id: USER_ID,
      username: "mood-patterns",
      email: "mood-patterns@example.test",
      timezone: "UTC",
    },
  });
});

describe("mood patterns", () => {
  it("finds the weekend and the note days in a seeded year", async () => {
    const { encryptToBytes } = await import("@/lib/ai/coach/bytes-codec");
    const now = new Date();
    const rows = [];
    for (let back = 1; back <= 200; back += 1) {
      const at = new Date(now.getTime() - back * 86_400_000);
      const date = at.toISOString().slice(0, 10);
      const weekday = (at.getUTCDay() + 6) % 7;
      const low = back % 3 === 0;
      const jitter = ((back * 37) % 10) / 20;
      const score = Math.min(
        5,
        Math.max(
          1,
          Math.round((weekday >= 5 ? 4.4 : 3) - (low ? 1 : 0) + jitter),
        ),
      );
      rows.push({
        userId: USER_ID,
        date,
        mood: "GUT" as const,
        score,
        source: "WEB" as const,
        moodLoggedAt: at,
        tz: "UTC",
        ...(low ? { noteEncrypted: encryptToBytes("a hard day") } : {}),
      });
    }
    await getPrismaClient().moodEntry.createMany({ data: rows as never });

    const { fetchMoodAggregates, moodInsightsWire } =
      await import("@/lib/insights/mood-aggregates");
    const aggregate = await fetchMoodAggregates(USER_ID, now);
    const year = moodInsightsWire(aggregate, 365, (k) => k).patterns;
    expect(year.map((p) => p.kind)).toContain("weekend");
    expect(year.find((p) => p.kind === "notes")).toMatchObject({
      direction: "lower",
    });
    const notes = year.find((p) => p.kind === "notes")!;
    expect(notes.sampleSize.subject).toBeGreaterThanOrEqual(60);
    const month = moodInsightsWire(aggregate, 30, (k) => k).patterns;
    for (const p of month) {
      expect(
        p.sampleSize.subject + p.sampleSize.comparison,
      ).toBeLessThanOrEqual(30);
    }
  });
});
