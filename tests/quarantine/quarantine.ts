/**
 * The flaky-test quarantine: a list of tests skipped while their flake is
 * fixed, each with an issue and an expiry date.
 *
 * A quarantined test is reported as skipped rather than retried into green,
 * so the run stays honest about what it did not check, and the entry cannot
 * outlive its excuse: once `expires` has passed the test runs again (and
 * `quarantine-guard.test.ts` goes red until the entry is removed). Both
 * suites apply the list from their setup files.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export interface QuarantineEntry {
  /** Path from the repository root, e.g. `tests/integration/foo.test.ts`. */
  file: string;
  /** Full name: describe blocks and the test, joined with " > ". */
  test: string;
  /** Where the flake is tracked: `#123` or a URL. */
  issue: string;
  /** What fails and how often, in a sentence. */
  reason: string;
  /** ISO date the entry was added. */
  added: string;
  /** ISO date after which the test runs again; at most 14 days after `added`. */
  expires: string;
}

export const QUARANTINE_FILE = resolve(import.meta.dirname, "quarantine.json");
export const MAX_QUARANTINE_DAYS = 14;
const ROOT = resolve(import.meta.dirname, "..", "..");

export function readQuarantine(path = QUARANTINE_FILE): QuarantineEntry[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    entries?: QuarantineEntry[];
  };
  return parsed.entries ?? [];
}

/** True while the entry's expiry date (inclusive) has not passed. */
export function isActive(
  entry: QuarantineEntry,
  today: Date = new Date(),
): boolean {
  return today.toISOString().slice(0, 10) <= entry.expires;
}

let cache: QuarantineEntry[] | null = null;

export interface TaskLike {
  name: string;
  suite?: TaskLike | null;
  file?: (TaskLike & { filepath?: string }) | null;
}

/** Describe blocks and the test, outermost first; the file task is the root. */
export function fullName(task: TaskLike): string {
  const names: string[] = [];
  let current: TaskLike | null | undefined = task;
  while (current && current !== current.file) {
    names.unshift(current.name);
    current = current.suite;
  }
  return names.join(" > ");
}

/** The active entry naming this test, if any. */
export function quarantineEntryFor(task: TaskLike): QuarantineEntry | null {
  cache ??= readQuarantine();
  if (cache.length === 0) return null;
  const filepath = task.file?.filepath;
  if (!filepath) return null;
  const file = relative(ROOT, filepath).split("\\").join("/");
  const name = fullName(task);
  return (
    cache.find((e) => e.file === file && e.test === name && isActive(e)) ?? null
  );
}
