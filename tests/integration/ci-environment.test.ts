import { describe, expect, it } from "vitest";

import { getPrismaClient } from "./setup";
import { TEMPLATE_DATABASE, workerDatabaseName } from "./worker-database";

const TEST_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";
const TEST_HMAC_KEY = "integration-test-hmac-key-32-bytes-minimum";
const TEST_SESSION_SECRET = "integration-test-session-secret-32-bytes";

describe("integration worker environment", () => {
  it("replaces ambient database and encryption configuration with test values", async () => {
    expect(process.env.DATABASE_URL).toContain("healthlog_test");
    expect(process.env.DATABASE_URL).not.toContain("ambient_database");
    expect(process.env.ENCRYPTION_KEY).toBe(TEST_ENCRYPTION_KEY);
    expect(process.env.ENCRYPTION_KEYS).toBeUndefined();
    expect(process.env.ENCRYPTION_ACTIVE_KEY_ID).toBeUndefined();
    expect(process.env.API_TOKEN_HMAC_KEY).toBe(TEST_HMAC_KEY);
    expect(process.env.SESSION_SECRET).toBe(TEST_SESSION_SECRET);

    const rows = await getPrismaClient().$queryRaw<
      Array<{ database_name: string }>
    >`
        SELECT current_database() AS database_name
      `;
    // Each worker runs against its own clone, never the migrated template
    // the clones are copied from.
    expect(rows).toEqual([{ database_name: workerDatabaseName() }]);
    expect(rows[0].database_name).not.toBe(TEMPLATE_DATABASE);
  });
});
