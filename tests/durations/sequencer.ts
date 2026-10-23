/**
 * Shard and order test files by how long they take, not by how many there are.
 *
 * Vitest's own `--shard` cuts the sorted file list into slices of equal
 * length. With files ranging from a tenth of a second to several minutes,
 * equal counts gave the integration shards 954 s to 1 449 s: the run waited
 * on the slowest slice while the fastest sat idle for eight minutes.
 *
 * This sequencer reads the measured duration of every file from a committed
 * timing file (`tests/durations/<suite>.json`, regenerated with
 * `node scripts/test-durations.mjs`) and deals the files out longest first,
 * each to the shard with the least work so far (the classic longest-
 * processing-time rule, within 4/3 of the best possible split). Every shard
 * job computes the same partition independently, because the input is the
 * same commit. A file with no measurement yet counts as the median, so a new
 * file lands somewhere sensible and the next regeneration fixes it.
 *
 * Inside a shard, files start longest first, so the slow ones are not left
 * for the end of a parallel run. `--sequence.shuffle` replaces that order
 * with a seeded shuffle; that is how the nightly run looks for order
 * dependence.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { BaseSequencer, type TestSpecification } from "vitest/node";

export interface DurationFile {
  /** What produced the numbers, for whoever wonders whether they are stale. */
  source: string;
  /** Seconds per file, keyed by the path relative to the repository root. */
  files: Record<string, number>;
}

export function readDurations(path: string): Map<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as DurationFile;
    return new Map(Object.entries(parsed.files));
  } catch {
    return new Map();
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Split `items` into `count` groups of near-equal total weight. Pure, so the
 * partition can be checked without a Vitest run.
 */
export function partitionByDuration<T>(
  items: readonly T[],
  count: number,
  weight: (item: T) => number,
  key: (item: T) => string,
): T[][] {
  const groups: { total: number; items: T[] }[] = Array.from(
    { length: count },
    () => ({ total: 0, items: [] }),
  );
  const ordered = [...items].sort(
    (a, b) => weight(b) - weight(a) || key(a).localeCompare(key(b)),
  );
  for (const item of ordered) {
    let target = groups[0];
    for (const group of groups) {
      if (group.total < target.total) target = group;
    }
    target.items.push(item);
    target.total += weight(item);
  }
  return groups.map((g) => g.items);
}

/**
 * `perFileSeconds` is what a file costs beyond its own reported duration:
 * the worker importing the module graph and running the setup file, which
 * the JSON report does not count. It dominates the unit suite (most files
 * finish in milliseconds and spend half a second importing), so without it
 * the split would hand one shard the thousands of quick files. Measured as
 * (wall time × workers − the sum of file durations) / files.
 */
export function createDurationSequencer(
  durationFile: string,
  perFileSeconds: number,
) {
  return class DurationSequencer extends BaseSequencer {
    private durations: Map<string, number> | null = null;

    private weightOf(spec: TestSpecification): number {
      if (!this.durations) {
        this.durations = readDurations(
          resolve(this.ctx.config.root, durationFile),
        );
      }
      const known = this.durations.get(this.pathOf(spec));
      return (known ?? median([...this.durations.values()])) + perFileSeconds;
    }

    private pathOf(spec: TestSpecification): string {
      return relative(this.ctx.config.root, spec.moduleId)
        .split("\\")
        .join("/");
    }

    override async shard(
      files: TestSpecification[],
    ): Promise<TestSpecification[]> {
      const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 };
      const groups = partitionByDuration(
        files,
        count,
        (spec) => this.weightOf(spec),
        (spec) => `${spec.project.name}:${this.pathOf(spec)}`,
      );
      return groups[index - 1] ?? [];
    }

    override async sort(
      files: TestSpecification[],
    ): Promise<TestSpecification[]> {
      const { sequence } = this.ctx.config;
      if (sequence.shuffle) return seededShuffle(files, sequence.seed);
      return [...files].sort((a, b) => {
        if (a.project.name !== b.project.name) {
          return a.project.name < b.project.name ? -1 : 1;
        }
        return (
          this.weightOf(b) - this.weightOf(a) ||
          this.pathOf(a).localeCompare(this.pathOf(b))
        );
      });
    }
  };
}

/** Fisher-Yates driven by a small deterministic generator (mulberry32). */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
