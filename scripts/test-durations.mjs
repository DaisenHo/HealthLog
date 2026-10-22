#!/usr/bin/env node
/**
 * Regenerate a timing file for the duration-balanced sequencer
 * (`tests/durations/sequencer.ts`) from Vitest JSON reports.
 *
 *   node scripts/test-durations.mjs <suite> <report.json> [<report.json> …]
 *
 * `<suite>` is `unit` or `integration` and names the file written,
 * `tests/durations/<suite>.json`. Pass every shard's report of one run; a
 * file measured twice keeps the longer reading. Files the reports do not
 * mention keep their previous value, so a partial run refines the table
 * rather than emptying it, and files that no longer exist are dropped.
 *
 * Produce a report with
 *   pnpm exec vitest run [--config …] --reporter=default \
 *     --reporter=json --outputFile.json=report.json
 * The nightly shuffled workflow uploads the reports of a CI run, which is
 * the better source: CI is where the shards have to balance.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [suite, ...reports] = process.argv.slice(2);

if (!["unit", "integration"].includes(suite ?? "") || reports.length === 0) {
  console.error(
    "usage: node scripts/test-durations.mjs <unit|integration> <report.json>…",
  );
  process.exit(2);
}

const target = resolve(root, "tests/durations", `${suite}.json`);
const previous = existsSync(target)
  ? JSON.parse(readFileSync(target, "utf8")).files
  : {};

const measured = new Map();
for (const report of reports) {
  const parsed = JSON.parse(readFileSync(report, "utf8"));
  for (const result of parsed.testResults ?? []) {
    if (typeof result.startTime !== "number") continue;
    if (typeof result.endTime !== "number") continue;
    const file = relative(root, result.name).split("\\").join("/");
    const seconds = Math.max(0, (result.endTime - result.startTime) / 1000);
    measured.set(file, Math.max(measured.get(file) ?? 0, seconds));
  }
}

if (measured.size === 0) {
  console.error("the reports carry no per-file timings; nothing written");
  process.exit(1);
}

const files = {};
const keys = new Set([...Object.keys(previous), ...measured.keys()]);
for (const file of [...keys].sort()) {
  if (!existsSync(resolve(root, file))) continue;
  const seconds = measured.get(file) ?? previous[file];
  files[file] = Math.round(seconds * 10) / 10;
}

writeFileSync(
  target,
  JSON.stringify(
    {
      source: `vitest JSON report of ${measured.size} files, written ${new Date().toISOString().slice(0, 10)}`,
      files,
    },
    null,
    2,
  ) + "\n",
);
const total = Object.values(files).reduce((a, b) => a + b, 0);
console.log(
  `${target}: ${Object.keys(files).length} files, ${Math.round(total)} s in total`,
);
