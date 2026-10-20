/**
 * The cached AI insights payload is read and written in one place.
 *
 * Since v1.43.7 the payload is sealed in `User.insightsCachedTextEncrypted`
 * and the readable `insightsCachedText` survives only as a fallback for rows
 * the backfill has not reached. Two columns that must move together are a
 * standing invitation to move one: a clear written as
 * `{ insightsCachedText: null }` — the shape every clear had until this
 * release — would now leave the whole sealed briefing behind, after a consent
 * withdrawal of all places. So the names are spelled in
 * `src/lib/insights/cached-text-cipher.ts`, and every other file goes through
 * its select, write, clear and open helpers.
 *
 * The allowlist below is the set of files with a reason to spell the legacy
 * name anyway, each stated. A file that joins it has to say why here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments, walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");

const ALLOWED: Readonly<Record<string, string>> = {
  "lib/insights/cached-text-cipher.ts": "the one module that owns the columns",
  "lib/jobs/free-text-encryption-backfill.ts":
    "the backfill that seals the legacy column",
  "lib/export/backup-plan.ts":
    "the backup classification names every User column",
  "lib/data-wipe/wipe-plan.ts":
    "the wipe reset names every User column it resets, and resets both",
  "lib/dashboard/snapshot.ts":
    "the snapshot builder's input field carries the OPENED text, not the column",
  "lib/dashboard/snapshot-read.ts":
    "fills that input field from openInsightsCachedText",
};

/** The legacy name, not its sealed sibling, outside comments. */
const LEGACY_NAME = /\binsightsCachedText\b(?!Encrypted)/;

function filesSpellingTheLegacyName(): string[] {
  return walkSourceFiles(SRC, { floor: 2000 })
    .filter((f) => !f.startsWith("generated/"))
    .filter((f) => !f.includes("__tests__/") && !/\.test\.tsx?$/.test(f))
    .filter((f) =>
      LEGACY_NAME.test(stripComments(readFileSync(join(SRC, f), "utf8"))),
    );
}

describe("insights cache column access", () => {
  const found = filesSpellingTheLegacyName();

  it("is confined to the cipher module and the stated exceptions", () => {
    const strays = found.filter((f) => !(f in ALLOWED));
    expect(strays).toEqual([]);
  });

  it("still finds every stated exception, so the matcher is live", () => {
    expect(found.length).toBeGreaterThan(5);
    expect([...found].sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});
