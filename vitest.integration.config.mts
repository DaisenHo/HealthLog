import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Integration suite — boots a real Postgres in a testcontainer and runs
// migrations against it. Slow (container boot ~5–15s on a cold pull),
// so excluded from the default `pnpm test` and triggered explicitly via
// `pnpm test:integration`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Same host-timezone pin as the unit config — CI runs UTC, so the
    // integration contracts must be read against the same clock.
    env: {
      TZ: "UTC",
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      ENCRYPTION_KEYS: "",
      ENCRYPTION_ACTIVE_KEY_ID: "",
      API_TOKEN_HMAC_KEY:
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      SESSION_SECRET: "integration-test-session-secret-32-bytes",
    },
    include: ["tests/integration/**/*.test.ts"],
    // Container boot + migration apply is slow; give each test a generous
    // budget and beforeAll/afterAll twice that.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Run sequentially in a single fork so files reuse one container and
    // amortise the migration-apply cost. Vitest 4 moved these to the top
    // level (the old `poolOptions.forks.singleFork` was removed).
    pool: "forks",
    fileParallelism: false,
    // v1.4.37 — switched from `isolate: false` to `isolate: true`.
    // The previous setting reused the module graph across files inside
    // one fork; mock declarations (`vi.mock("@/lib/notifications/...")`,
    // `vi.mock("@parse/node-apn")`) registered in `apns-dispatch.test.ts`
    // and `integration-status.test.ts` lost to whichever earlier file
    // had already pulled the real dispatcher / sender modules into the
    // shared graph, so the in-suite run showed flaky 0-call mocks while
    // each file passed in isolation. Re-isolating module state per file
    // costs ~10 s of import-rebuild on a 56-file run; the Postgres
    // testcontainer + migrations still live in `globalSetup` so the
    // expensive boot cost is unaffected.
    isolate: true,
    // One container for the whole run; tests truncate between them.
    // Bridge the global Testcontainers URL into each isolated worker before
    // application modules read DATABASE_URL at import time.
    setupFiles: ["./tests/integration/environment-setup.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
