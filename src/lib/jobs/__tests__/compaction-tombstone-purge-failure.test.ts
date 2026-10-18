/**
 * A purge run that hits a database failure says what it was doing and why.
 *
 * Before #1239 the run threw the bare Prisma error, whose message carries the
 * condition only as a SQLSTATE, and the support report showed seven failed
 * runs as "Error". The reason now names the stage and the condition.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/jobs/boss-instance", () => ({ getGlobalBoss: () => null }));
vi.mock("@/lib/jobs/job-run-report", () => ({ reportJobRun: vi.fn() }));

import { handleCompactionTombstonePurge } from "../compaction-tombstone-purge";

const STATEMENT_TIMEOUT =
  "\nInvalid `prisma.measurement.findMany()` invocation:\n\n\nDatabase error. Code: `57014`. Message: `canceling statement due to statement timeout`";

describe("compaction tombstone purge failures", () => {
  it("names the stage and the condition when the scan times out", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn().mockRejectedValue(new Error(STATEMENT_TIMEOUT)),
      },
    };
    const outcome = await handleCompactionTombstonePurge(
      [{ id: "job-1", data: {} } as never],
      prisma as never,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe(
        "stopped while scanning tombstones (statement_timeout)",
      );
      expect((outcome.cause as Error).message).toBe(
        "stopped while scanning tombstones (statement_timeout)",
      );
      expect(((outcome.cause as Error).cause as Error).message).toBe(
        STATEMENT_TIMEOUT,
      );
    }
  });

  it("falls back to the error's class when no condition is named", async () => {
    const prisma = {
      measurement: {
        findMany: vi.fn().mockRejectedValue(new TypeError("boom")),
      },
    };
    const outcome = await handleCompactionTombstonePurge(
      [{ id: "job-2", data: {} } as never],
      prisma as never,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe(
        "stopped while scanning tombstones (TypeError)",
      );
    }
  });
});
