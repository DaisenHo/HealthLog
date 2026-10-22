/**
 * Mutation testing for the core libraries: the modules where a wrong answer
 * is silent and costly (encryption at rest, medication compliance, rollups,
 * source ranking, unit conversion, backup validation).
 *
 * Not on pull requests: the full run takes the better part of an hour. It
 * runs nightly and on demand (`.github/workflows/mutation.yml`), and locally
 * with `pnpm exec stryker run`. The score of each module is checked against
 * the floor in `stryker.floors.json` by `node scripts/mutation-floors.mjs`,
 * so a floor is per module rather than one number for the whole run.
 *
 * The tests that run are the unit tests next to these modules (see
 * `vitest.mutation.config.mts`), not the whole suite: a mutant that only a
 * route test or an integration test would catch counts as surviving here,
 * so a score is a lower bound on what the full suite catches.
 *
 * Vitest 5 names a test "describe > test" where @stryker-mutator/vitest-runner
 * 10.0.0 still built "describe test", so every test inside a describe block
 * was filtered out of the mutant runs and nearly every mutant survived.
 * `patches/@stryker-mutator__vitest-runner@10.0.0.patch` builds the name the
 * Vitest 5 way; drop it once a runner release does the same.
 */
const config = {
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.mts" },
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: [
    "src/lib/crypto.ts",
    "src/lib/analytics/compliance/*.ts",
    "src/lib/rollups/measurement-rollups.ts",
    "src/lib/rollups/tiered-context.ts",
    "src/lib/analytics/source-priority.ts",
    "src/lib/analytics/source-rank-sql.ts",
    "src/lib/measurements/display-transform.ts",
    "src/lib/glucose.ts",
    "src/lib/validations/backup.ts",
  ],
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // The per-module floors live in stryker.floors.json; the run itself never
  // fails on a score, only on an error.
  thresholds: { high: 80, low: 60, break: null },
  timeoutMS: 20_000,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  ignorePatterns: [
    "/.next",
    "/e2e",
    "/docs",
    "/public",
    "/assets",
    "/reports",
    "/playwright-report",
    "/test-results",
    "/tests/integration",
  ],
};

export default config;
