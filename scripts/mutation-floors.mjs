#!/usr/bin/env node
/**
 * Check each module's mutation score against its floor.
 *
 *   node scripts/mutation-floors.mjs [reports/mutation/mutation.json]
 *
 * Stryker's own `thresholds.break` is one number for the whole run, which
 * lets a well-tested module hide a weak one. `stryker.floors.json` names a
 * floor per module instead (a module is a set of path prefixes), and this
 * script reads the JSON report Stryker writes and fails when any module
 * scores below its floor. The score is Stryker's: killed and timed-out
 * mutants over every mutant that was valid and covered or not, so a mutant no
 * test reaches counts against the module.
 *
 * Floors sit just below the last measured score. Raise one when a change
 * raises the score; a floor that is lowered to let a run pass has stopped
 * being a floor.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(
  root,
  process.argv[2] ?? "reports/mutation/mutation.json",
);
const floorsPath = resolve(root, "stryker.floors.json");

if (!existsSync(reportPath)) {
  console.error(
    `no mutation report at ${reportPath}; run pnpm exec stryker run`,
  );
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const { modules } = JSON.parse(readFileSync(floorsPath, "utf8"));

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

const files = Object.entries(report.files ?? {}).map(([path, file]) => [
  relative(root, resolve(root, path)).split("\\").join("/"),
  file,
]);

let failed = false;
const rows = [];
for (const [name, { paths, floor }] of Object.entries(modules)) {
  let detected = 0;
  let undetected = 0;
  let matched = 0;
  for (const [path, file] of files) {
    if (!paths.some((prefix) => path.startsWith(prefix))) continue;
    matched += 1;
    for (const mutant of file.mutants ?? []) {
      if (DETECTED.has(mutant.status)) detected += 1;
      else if (UNDETECTED.has(mutant.status)) undetected += 1;
    }
  }
  const total = detected + undetected;
  const score = total === 0 ? null : (100 * detected) / total;
  const ok = matched > 0 && score !== null && score >= floor;
  if (!ok) failed = true;
  rows.push(
    `${ok ? "ok  " : "FAIL"} ${name.padEnd(16)} ${
      score === null ? "no mutants" : `${score.toFixed(1)} %`
    } (floor ${floor} %, ${detected}/${total} mutants, ${matched} files)`,
  );
}

console.log(rows.join("\n"));
if (failed) {
  console.error(
    "\nA module scored below its floor, or the report covered none of its files.",
  );
  process.exit(1);
}
