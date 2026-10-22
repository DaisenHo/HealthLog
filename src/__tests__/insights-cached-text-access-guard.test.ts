/**
 * The cached AI insights payload is read and written in one place.
 *
 * The payload is sealed in `User.insightsCachedTextEncrypted`; the readable
 * `insightsCachedText` column it replaced was dropped in v1.44.0 (migration
 * 0430). Every reader and writer goes through
 * `src/lib/insights/cached-text-cipher.ts` (its select, write, clear and open
 * helpers), so a clear cannot forget the column and a read cannot skip the
 * decryption. The column name is spelled there and in the tables that have
 * to name every column of the row.
 *
 * The readable name survives only as the snapshot builder's input field, which
 * carries the OPENED text, never the column.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments, walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");

const SEALED_ALLOWED: Readonly<Record<string, string>> = {
  "lib/insights/cached-text-cipher.ts": "the one module that owns the column",
  "lib/crypto/encrypted-columns.ts":
    "the registry of every ciphertext-bearing column",
  "lib/export/backup-plan.ts":
    "the backup classification names every User column",
  "lib/data-wipe/wipe-plan.ts": "the wipe reset names every User column",
};

const OPENED_TEXT_ALLOWED: Readonly<Record<string, string>> = {
  "lib/dashboard/snapshot.ts":
    "the snapshot builder's input field carries the opened text",
  "lib/dashboard/snapshot-read.ts":
    "fills that input field from openInsightsCachedText",
};

const SEALED_NAME = /\binsightsCachedTextEncrypted\b/;
/** The dropped readable name, not its sealed sibling. */
const READABLE_NAME = /\binsightsCachedText\b(?!Encrypted)/;

function sourceFilesMatching(pattern: RegExp): string[] {
  return walkSourceFiles(SRC, { floor: 2000 })
    .filter((f) => !f.startsWith("generated/"))
    .filter((f) => !f.includes("__tests__/") && !/\.test\.tsx?$/.test(f))
    .filter((f) =>
      pattern.test(stripComments(readFileSync(join(SRC, f), "utf8"))),
    )
    .sort();
}

describe("insights cache column access", () => {
  it("spells the sealed column only in the cipher module and the stated tables", () => {
    const found = sourceFilesMatching(SEALED_NAME);
    expect(found.length).toBe(4);
    expect(found).toEqual(Object.keys(SEALED_ALLOWED).sort());
  });

  it("uses the readable name only for the opened text the snapshot builder takes", () => {
    const found = sourceFilesMatching(READABLE_NAME);
    expect(found.length).toBe(2);
    expect(found).toEqual(Object.keys(OPENED_TEXT_ALLOWED).sort());
  });
});
