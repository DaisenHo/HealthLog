/**
 * What the Withings sleep sync learned reading each night's stage timeline,
 * kept on `WithingsConnection.sleepStageReads`.
 *
 * Two facts per night, keyed by its unix span (`"<start>:<end>"`):
 *
 *   - `empty`: reads that answered without a single stage. A tracker that
 *     never stages a night (a nap, a watch without stages) used to be read
 *     again on every run for as long as the night stayed in the 30-day
 *     window. After {@link SLEEP_STAGE_MAX_EMPTY_READS} such answers it is
 *     no longer read, except by a full sync or while Withings marks it
 *     changed.
 *   - `failed`: the night's last read errored. It is read first next run.
 *
 * Versioned and validated on read: anything that is not the current shape
 * reads as no record at all, which is the behaviour before the record
 * existed.
 */

export const SLEEP_STAGE_MAX_EMPTY_READS = 3;

export interface SleepStageNightRecord {
  empty: number;
  failed: boolean;
}

export type SleepStageReads = Map<string, SleepStageNightRecord>;

export function sleepNightKey(night: {
  startdate: number;
  enddate: number;
}): string {
  return `${night.startdate}:${night.enddate}`;
}

export function parseSleepStageReads(raw: unknown): SleepStageReads {
  const out: SleepStageReads = new Map();
  if (raw === null || typeof raw !== "object") return out;
  const record = raw as { v?: unknown; nights?: unknown };
  if (record.v !== 1) return out;
  if (record.nights === null || typeof record.nights !== "object") return out;
  for (const [key, value] of Object.entries(record.nights)) {
    if (!/^\d+:\d+$/.test(key)) continue;
    if (value === null || typeof value !== "object") continue;
    const { empty, failed } = value as { empty?: unknown; failed?: unknown };
    const count =
      typeof empty === "number" && Number.isInteger(empty) && empty >= 0
        ? empty
        : 0;
    out.set(key, { empty: count, failed: failed === true });
  }
  return out;
}

export function serialiseSleepStageReads(reads: SleepStageReads): {
  v: 1;
  nights: Record<string, { empty: number; failed?: true }>;
} {
  const nights: Record<string, { empty: number; failed?: true }> = {};
  for (const [key, night] of reads) {
    if (night.empty === 0 && !night.failed) continue;
    nights[key] = night.failed
      ? { empty: night.empty, failed: true }
      : { empty: night.empty };
  }
  return { v: 1, nights };
}

/** The outcome of one night's read in this run. */
export type SleepStageReadOutcome = "staged" | "empty" | "failed";

/**
 * The record after this run: each read night's outcome applied, and every
 * night that is no longer in the summary window dropped.
 */
export function nextSleepStageReads(
  previous: SleepStageReads,
  outcomes: ReadonlyMap<string, SleepStageReadOutcome>,
  windowNightKeys: ReadonlySet<string>,
): SleepStageReads {
  const next: SleepStageReads = new Map();
  for (const [key, night] of previous) {
    if (windowNightKeys.has(key)) next.set(key, { ...night });
  }
  for (const [key, outcome] of outcomes) {
    const prior = next.get(key) ?? { empty: 0, failed: false };
    if (outcome === "staged") next.delete(key);
    else if (outcome === "failed") next.set(key, { ...prior, failed: true });
    else next.set(key, { empty: prior.empty + 1, failed: false });
  }
  return next;
}
