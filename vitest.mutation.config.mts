import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The unit tests Stryker runs against each mutant (see `stryker.config.mjs`):
 * the tests that live next to the mutated modules, property tests included.
 * Kept narrow on purpose, because Stryker runs this set once to map coverage
 * and then the covering tests once per mutant. Same environment as the unit
 * suite (`vitest.config.mts`): UTC host zone, the same setup file.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: { TZ: "UTC" },
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "src/lib/__tests__/crypto*.test.ts",
      "src/lib/analytics/compliance/__tests__/**/*.test.ts",
      "src/lib/rollups/__tests__/**/*.test.ts",
      "src/lib/analytics/__tests__/source-*.test.ts",
      "src/lib/measurements/__tests__/display-transform*.test.ts",
      "src/lib/measurements/__tests__/units.property.test.ts",
      "src/lib/__tests__/glucose*.test.ts",
      "src/lib/validations/__tests__/backup*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
