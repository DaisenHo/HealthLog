/**
 * The quarantine list cannot outlive its excuses.
 *
 * Every entry names an issue, a reason, the day it was added, and a day it
 * expires, at most two weeks later. Past that day this guard fails, and the
 * test runs again in both suites whether or not the entry is removed, so a
 * flake that nobody fixed becomes a red build instead of a permanent skip.
 * The file and the test the entry names must exist, so an entry cannot
 * quietly cover a test that was renamed.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_QUARANTINE_DAYS,
  fullName,
  isActive,
  readQuarantine,
  type QuarantineEntry,
  type TaskLike,
} from "./quarantine";

const ROOT = resolve(import.meta.dirname, "..", "..");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function problems(entry: QuarantineEntry, today: Date): string[] {
  const found: string[] = [];
  for (const field of [
    "file",
    "test",
    "issue",
    "reason",
    "added",
    "expires",
  ] as const) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      found.push(`missing ${field}`);
    }
  }
  if (found.length > 0) return found;
  if (!/^#\d+$|^https:\/\//.test(entry.issue)) {
    found.push(`issue must be "#<number>" or a URL, got "${entry.issue}"`);
  }
  if (!ISO_DATE.test(entry.added) || !ISO_DATE.test(entry.expires)) {
    found.push("added and expires must be YYYY-MM-DD");
    return found;
  }
  const days =
    (Date.parse(`${entry.expires}T00:00:00Z`) -
      Date.parse(`${entry.added}T00:00:00Z`)) /
    86_400_000;
  if (days < 0 || days > MAX_QUARANTINE_DAYS) {
    found.push(
      `expires ${days} days after it was added; the limit is ${MAX_QUARANTINE_DAYS}`,
    );
  }
  if (!isActive(entry, today)) {
    found.push(
      `expired on ${entry.expires}: fix the test or delete it, then remove the entry`,
    );
  }
  const path = resolve(ROOT, entry.file);
  if (!existsSync(path)) {
    found.push(`${entry.file} does not exist`);
  } else {
    const leaf = entry.test.split(" > ").pop() ?? "";
    if (!readFileSync(path, "utf8").includes(leaf)) {
      found.push(`${entry.file} has no test named "${leaf}"`);
    }
  }
  return found;
}

describe("the flaky-test quarantine", () => {
  it("holds only live, complete, bounded entries", () => {
    const today = new Date();
    const report = readQuarantine().flatMap((entry) =>
      problems(entry, today).map((p) => `${entry.file} > ${entry.test}: ${p}`),
    );
    expect(report).toEqual([]);
  });

  it("names each test once", () => {
    const keys = readQuarantine().map((e) => `${e.file}::${e.test}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("refuses the entries it exists to refuse", () => {
    const today = new Date("2026-10-22T09:00:00Z");
    const base: QuarantineEntry = {
      file: "tests/quarantine/quarantine-guard.test.ts",
      test: "the flaky-test quarantine > names each test once",
      issue: "#1",
      reason: "fails one run in twenty",
      added: "2026-10-20",
      expires: "2026-10-30",
    };
    expect(problems(base, today)).toEqual([]);
    expect(problems({ ...base, expires: "2026-10-21" }, today)).toEqual([
      expect.stringMatching(/^expired on 2026-10-21/),
    ]);
    expect(problems({ ...base, expires: "2026-11-20" }, today)).toEqual([
      expect.stringMatching(/the limit is 14/),
    ]);
    expect(problems({ ...base, issue: "soon" }, today)).toHaveLength(1);
    // Built at run time, so the name cannot occur in this file's own source.
    const gone = ["renamed", "away"].join("-");
    expect(problems({ ...base, test: `a > ${gone}` }, today)).toEqual([
      expect.stringContaining(`has no test named "${gone}"`),
    ]);
    // The expiry day itself still counts as quarantined.
    expect(isActive(base, new Date("2026-10-30T23:00:00Z"))).toBe(true);
    expect(isActive(base, new Date("2026-10-31T00:00:00Z"))).toBe(false);
  });

  it("builds the full name a test is listed under", () => {
    const file: TaskLike & { filepath: string } = {
      name: "tests/x.test.ts",
      filepath: "/x",
    };
    file.file = file;
    const outer: TaskLike = { name: "outer", suite: file, file };
    const test: TaskLike = { name: "does a thing", suite: outer, file };
    expect(fullName(test)).toBe("outer > does a thing");
  });
});
