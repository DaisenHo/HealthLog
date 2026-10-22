/**
 * A ratchet: a committed baseline of counts that may only fall.
 *
 * Each ratchet guard measures something per key (lines per file, `as never`
 * per test file, one per file on a list) and compares it with a JSON baseline
 * under `src/__tests__/baselines/`. Three things fail:
 *
 *   - a key that is not in the baseline (a new offender);
 *   - a key whose value rose above its baseline (an offender that grew);
 *   - a key that fell below its baseline by more than the ratchet's `slack`,
 *     or disappeared (an improvement nobody wrote down).
 *
 * The third is what makes it a ratchet rather than a ceiling: an improvement
 * that is not written back leaves room for the next regression to hide in.
 * Writing back is one command, printed in every failure:
 *
 *   RATCHET_WRITE=1 pnpm vitest run <guard file>
 *
 * which rewrites the baseline with the lower of the recorded and the
 * measured value for every key, drops keys that reached zero, and never
 * raises anything. Raising a value, or adding a key, is a hand edit of the
 * JSON in a reviewed change, with the reason in the PR.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASELINE_DIR = join(process.cwd(), "src/__tests__/baselines");

export interface RatchetBaseline {
  $comment: string;
  /** Number of keys, kept in the file so a reader sees the headline. */
  count: number;
  /** Sum of `entries`. */
  total: number;
  entries: Record<string, number>;
}

export interface RatchetResult {
  count: number;
  total: number;
  baselineCount: number;
  baselineTotal: number;
  /** New keys and keys above their baseline, as readable lines. */
  grew: string[];
  /** Keys that fell below their baseline beyond the slack, or vanished. */
  stale: string[];
}

function sum(entries: Record<string, number>): number {
  return Object.values(entries).reduce((a, b) => a + b, 0);
}

export function readBaseline(file: string): RatchetBaseline {
  return JSON.parse(
    readFileSync(join(BASELINE_DIR, file), "utf8"),
  ) as RatchetBaseline;
}

/**
 * Compare measured counts against the baseline in `file`. With
 * `RATCHET_WRITE=1` in the environment the lower numbers are written back
 * first, so the comparison that follows passes on everything but growth.
 */
export function runRatchet(
  file: string,
  measured: Record<string, number>,
  options: { slack?: number; comment?: string } = {},
): RatchetResult {
  const slack = options.slack ?? 0;
  const current = Object.fromEntries(
    Object.entries(measured).filter(([, v]) => v > 0),
  );
  const write = process.env.RATCHET_WRITE === "1";
  // The one case where writing records the measured numbers as they are: a
  // baseline that does not exist yet. Deleting a baseline to re-seed it
  // higher shows up as a whole-file diff in review.
  if (write && !existsSync(join(BASELINE_DIR, file))) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(
      join(BASELINE_DIR, file),
      `${JSON.stringify({ $comment: options.comment ?? "", count: 0, total: 0, entries: current }, null, 2)}\n`,
    );
  }
  let baseline = readBaseline(file);

  if (write) {
    const lowered: Record<string, number> = {};
    for (const [key, recorded] of Object.entries(baseline.entries)) {
      const now = current[key] ?? 0;
      const value = Math.min(recorded, now);
      if (value > 0) lowered[key] = value;
    }
    const sorted = Object.fromEntries(
      Object.entries(lowered).sort(([a], [b]) => a.localeCompare(b)),
    );
    baseline = {
      $comment: baseline.$comment,
      count: Object.keys(sorted).length,
      total: sum(sorted),
      entries: sorted,
    };
    writeFileSync(
      join(BASELINE_DIR, file),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
  }

  const grew: string[] = [];
  const stale: string[] = [];
  for (const [key, value] of Object.entries(current)) {
    const recorded = baseline.entries[key];
    if (recorded === undefined) grew.push(`${key}: new, ${value}`);
    else if (value > recorded) grew.push(`${key}: ${recorded} → ${value}`);
  }
  for (const [key, recorded] of Object.entries(baseline.entries)) {
    const value = current[key] ?? 0;
    if (value < recorded - slack) stale.push(`${key}: ${recorded} → ${value}`);
  }
  return {
    count: Object.keys(current).length,
    total: sum(current),
    baselineCount: baseline.count,
    baselineTotal: baseline.total,
    grew: grew.sort(),
    stale: stale.sort(),
  };
}

export function writeBackHint(guardFile: string): string {
  return (
    `The baseline records a higher number than the tree now has. Write the ` +
    `lower numbers back so the ratchet tightens: ` +
    `RATCHET_WRITE=1 pnpm vitest run ${guardFile}`
  );
}

/** Read a baseline of another shape than counts per key, or null if absent. */
export function readBaselineJson<T>(file: string): T | null {
  const path = join(BASELINE_DIR, file);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as T)
    : null;
}

export function writeBaselineJson(file: string, value: unknown): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(
    join(BASELINE_DIR, file),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}
