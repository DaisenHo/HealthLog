/**
 * The record `topics-preview.spec.ts` reads its topics from.
 *
 * Enough of each kind that every topic the account is offered has something
 * to show, and some of it deliberately short of the thresholds, so the page
 * states what is missing rather than a figure:
 *
 *  - 40 days of resting heart rate, heart-rate variability and sleep, with
 *    every fourth night under seven hours and the morning after it higher:
 *    the heart pairs reach 14 paired days and say something;
 *  - 30 days of weight, 25 of blood pressure;
 *  - 12 days of steps: the steps pairs stay below 14 and say so;
 *  - 10 mood entries: the mind pairs stay below 14 and say so;
 *  - LDL three times over two years (a trend line) and vitamin D once
 *    (below its range, no trend yet).
 *
 * The readings go straight into Postgres: the topics read the live table, and
 * a few hundred route calls would only slow `globalSetup` down. Mood entries
 * and lab results go through the app's routes, which own their encryption and
 * the marker catalogue. An account that already holds the LDL marker is taken
 * as seeded, so a local re-run against a reused database does not double it.
 */
import { randomUUID } from "node:crypto";

import { request as playwrightRequest } from "@playwright/test";
import pg from "pg";

export const TOPICS_LAB_MARKER = "LDL";

const DAY_MS = 86_400_000;

type Row = [type: string, unit: string, value: number, measuredAt: Date];

/** The readings, one per local morning, ending yesterday. */
function readings(now: number): Row[] {
  const at = (daysAgo: number, hourUtc: number) => {
    const d = new Date(now - daysAgo * DAY_MS);
    d.setUTCHours(hourUtc, 30, 0, 0);
    return d;
  };
  const rows: Row[] = [];
  for (let i = 1; i <= 40; i++) {
    const shortNight = i % 4 === 0;
    rows.push(["SLEEP_DURATION", "min", shortNight ? 360 : 480, at(i, 5)]);
    rows.push([
      "RESTING_HEART_RATE",
      "bpm",
      55 + (i % 10) + (shortNight ? 5 : 0),
      at(i, 6),
    ]);
    rows.push(["HEART_RATE_VARIABILITY", "ms", 80 - (i % 10) * 3, at(i, 6)]);
  }
  for (let i = 1; i <= 30; i++) {
    rows.push(["WEIGHT", "kg", 82 - (30 - i) * 0.03, at(i, 6)]);
  }
  for (let i = 1; i <= 25; i++) {
    rows.push(["BLOOD_PRESSURE_SYS", "mmHg", 118 + (i % 5), at(i, 7)]);
    rows.push(["BLOOD_PRESSURE_DIA", "mmHg", 76 + (i % 3), at(i, 7)]);
    rows.push(["PULSE", "bpm", 64 + (i % 4), at(i, 7)]);
  }
  for (let i = 1; i <= 12; i++) {
    rows.push(["ACTIVITY_STEPS", "steps", 7000 + (i % 5) * 900, at(i, 18)]);
  }
  return rows;
}

export async function seedTopicsRecord(
  baseURL: string,
  storageStatePath: string,
  username: string,
): Promise<void> {
  const ctx = await playwrightRequest.newContext({
    baseURL,
    storageState: storageStatePath,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("[topics-fixture] DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url });
  try {
    const labs = await ctx.get("/api/labs");
    const body = (await labs.json()) as { data: unknown };
    if (JSON.stringify(body.data ?? null).includes(`"${TOPICS_LAB_MARKER}"`)) {
      return;
    }

    const user = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("[topics-fixture] topics account not seeded");

    const now = Date.now();
    for (const [type, unit, value, measuredAt] of readings(now)) {
      await pool.query(
        `INSERT INTO measurements
           (id, user_id, type, value, unit, source, measured_at, updated_at)
         VALUES ($1, $2, $3::"measurement_type", $4, $5, 'MANUAL', $6, now())`,
        [randomUUID(), userId, type, value, unit, measuredAt],
      );
    }

    const post = async (path: string, data: unknown): Promise<void> => {
      const res = await ctx.post(path, { data });
      if (res.status() === 409 || res.ok()) return;
      throw new Error(
        `[topics-fixture] ${path} answered ${res.status()}: ${(await res.text()).slice(0, 200)}`,
      );
    };
    for (let i = 1; i <= 10; i++) {
      const at = new Date(now - i * DAY_MS);
      at.setUTCHours(19, 0, 0, 0);
      await post("/api/mood-entries", {
        mood: i % 3 === 0 ? "OKAY" : "GUT",
        moodLoggedAt: at.toISOString(),
      });
    }
    for (const [analyte, unit, value, daysAgo, low, high] of [
      [TOPICS_LAB_MARKER, "mg/dL", 140, 760, 0, 130],
      [TOPICS_LAB_MARKER, "mg/dL", 121, 390, 0, 130],
      [TOPICS_LAB_MARKER, "mg/dL", 98, 20, 0, 130],
      ["Vitamin D", "ng/mL", 24, 25, 30, 100],
    ] as const) {
      await post("/api/labs", {
        analyte,
        panel: "Topics",
        value,
        unit,
        referenceLow: low,
        referenceHigh: high,
        takenAt: new Date(now - daysAgo * DAY_MS).toISOString(),
      });
    }
  } finally {
    await pool.end();
    await ctx.dispose();
  }
}
