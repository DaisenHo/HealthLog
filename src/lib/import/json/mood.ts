/**
 * The mood rows of a JSON import (`POST /api/import`).
 *
 * A row with an external id upserts on `(userId, source, externalId)`. A row
 * without a logged instant gets a stable fallback instant inside its day,
 * derived from the row's content and its occurrence in the file, so the same
 * file lands on the same instants every time and twin rows land on distinct
 * ones.
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { ENTRY_INSTANT_CLOCK_SKEW_MS } from "@/lib/validations/entry-instant";
import { classifyExternalId } from "@/lib/validations/external-id";
import { isP2002 } from "@/lib/prisma-errors";
import { moodDateKey } from "@/lib/mood/date-key";
import { DEFAULT_TIMEZONE } from "@/lib/tz/format";
import { deriveA1 } from "@/lib/mood/level-a";
import { zonedWallClockToUtc } from "@/lib/tz/wall-clock";

import type { JsonImportTally } from "./tally";

export interface JsonImportMoodEntry {
  date: string;
  mood: "SUPER_GUT" | "GUT" | "OKAY" | "SCHLECHT" | "LAUSIG";
  score: number;
  tags?: string;
  loggedAt?: Date;
  externalId?: string;
}

/**
 * The start of a `YYYY-MM-DD` day in the default zone, or null when the
 * string does not name a real day. The route's schema uses it to bound a row
 * without a logged instant.
 */
export function fallbackMoodDateStart(date: string): Date | null {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const instant = zonedWallClockToUtc(
    { year, month, day, hour: 0, minute: 0 },
    DEFAULT_TIMEZONE,
  );
  return moodDateKey(instant, DEFAULT_TIMEZONE) === date ? instant : null;
}

function fallbackMoodIdentity(entry: JsonImportMoodEntry): string {
  return JSON.stringify([
    entry.date,
    entry.mood,
    entry.score,
    entry.tags ?? null,
    entry.externalId ?? null,
  ]);
}

function stableFallbackMoodInstant(
  entry: JsonImportMoodEntry,
  occurrence: number,
  probe: number,
): Date {
  const digest = createHash("sha256")
    .update(`${fallbackMoodIdentity(entry)}:${occurrence}`)
    .digest();
  const initialOffset = digest.readUInt32BE(0) % ENTRY_INSTANT_CLOCK_SKEW_MS;
  const offset = (initialOffset + probe) % ENTRY_INSTANT_CLOCK_SKEW_MS;
  const dateStart = fallbackMoodDateStart(entry.date);
  if (!dateStart) throw new Error("Invalid mood date");
  return new Date(dateStart.getTime() + offset);
}

/** The fallback instants this import has handed out, and how often each row content occurred. */
interface FallbackState {
  occurrences: Map<string, number>;
  reserved: Set<number>;
}

async function writeMoodEntry(
  userId: string,
  e: JsonImportMoodEntry,
  loggedAt: Date,
): Promise<void> {
  if (e.externalId) {
    // Idempotent re-import keyed on the source-stable id. A second import
    // of the same export updates the row in place rather than skipping it as
    // a duplicate, so an upstream edit (re-scored mood, added tag) is
    // reflected.
    await prisma.moodEntry.upsert({
      where: {
        userId_source_externalId: {
          userId,
          source: "IMPORT",
          externalId: e.externalId,
        },
      },
      update: {
        date: e.date,
        mood: e.mood,
        score: e.score,
        // Pleasantness derived from the row's own label, not from the file's
        // `score`. This is the one writer whose score comes out of the file
        // rather than out of the label, so the two can disagree; the column
        // that records a self-assessment has to agree with the label the
        // user actually picked.
        moodA1: deriveA1(e.mood),
        tags: e.tags || null,
        moodLoggedAt: loggedAt,
      },
      create: {
        userId,
        date: e.date,
        mood: e.mood,
        score: e.score,
        moodA1: deriveA1(e.mood),
        tags: e.tags || null,
        source: "IMPORT",
        externalId: e.externalId,
        moodLoggedAt: loggedAt,
      },
    });
  } else {
    await prisma.moodEntry.create({
      data: {
        userId,
        date: e.date,
        mood: e.mood,
        score: e.score,
        // See the upsert arm above: derived from the label, because an
        // imported file's `score` is its own field.
        moodA1: deriveA1(e.mood),
        tags: e.tags || null,
        source: "IMPORT",
        moodLoggedAt: loggedAt,
      },
    });
  }
}

/**
 * Whether the row already stored at `loggedAt` is this very fallback row
 * from an earlier import of the same file. Throws when the probe fails.
 */
async function sameImportedRow(
  userId: string,
  e: JsonImportMoodEntry,
  loggedAt: Date,
): Promise<boolean> {
  const existing = await prisma.moodEntry.findUnique({
    where: {
      userId_date_moodLoggedAt: {
        userId,
        date: e.date,
        moodLoggedAt: loggedAt,
      },
    },
    select: {
      source: true,
      mood: true,
      score: true,
      tags: true,
      externalId: true,
    },
  });
  return (
    existing?.source === "IMPORT" &&
    existing.mood === e.mood &&
    existing.score === e.score &&
    existing.tags === (e.tags || null) &&
    (existing.externalId ?? null) === null
  );
}

async function importMoodEntry(
  userId: string,
  e: JsonImportMoodEntry,
  fallback: FallbackState,
  tally: JsonImportTally,
): Promise<void> {
  // Same stability floor as the measurement rows: the mood upsert keys on
  // `(userId, source, externalId)`.
  const unstableMood =
    e.externalId === undefined ? null : classifyExternalId(e.externalId);
  if (unstableMood) {
    tally.unstableShapes.push(unstableMood);
    tally.stats.skipped++;
    return;
  }
  const identity = e.loggedAt ? null : fallbackMoodIdentity(e);
  const occurrence =
    identity === null ? 0 : (fallback.occurrences.get(identity) ?? 0);
  if (identity !== null) {
    fallback.occurrences.set(identity, occurrence + 1);
  }

  for (let probe = 0; probe < ENTRY_INSTANT_CLOCK_SKEW_MS; probe++) {
    const loggedAt =
      e.loggedAt ?? stableFallbackMoodInstant(e, occurrence, probe);
    if (!e.loggedAt && fallback.reserved.has(loggedAt.getTime())) {
      continue;
    }
    try {
      await writeMoodEntry(userId, e, loggedAt);
      if (!e.loggedAt) {
        fallback.reserved.add(loggedAt.getTime());
      }
      tally.stats.moodEntries++;
      return;
    } catch (err) {
      if (!isP2002(err)) {
        tally.writeFailed = true;
        return;
      }
      if (e.loggedAt) {
        tally.stats.skipped++;
        return;
      }
      if (!e.externalId) {
        try {
          if (await sameImportedRow(userId, e, loggedAt)) {
            fallback.reserved.add(loggedAt.getTime());
            tally.stats.skipped++;
            return;
          }
        } catch {
          tally.writeFailed = true;
          return;
        }
      }
      if (probe === ENTRY_INSTANT_CLOCK_SKEW_MS - 1) {
        tally.writeFailed = true;
      }
    }
  }
}

/**
 * Write `rows` for `userId`, counting into `tally`. Stops at the first row
 * whose write failed for a reason other than a duplicate.
 */
export async function importJsonMoodEntries(
  userId: string,
  rows: JsonImportMoodEntry[],
  tally: JsonImportTally,
): Promise<void> {
  const fallback: FallbackState = {
    occurrences: new Map(),
    reserved: new Set(),
  };
  for (const e of rows) {
    await importMoodEntry(userId, e, fallback, tally);
    if (tally.writeFailed) break;
  }
}
