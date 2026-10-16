/**
 * `GET /api/admin/support-report` end to end over a mocked database: the
 * collector, the renderer and the redaction together. Accounts are seeded
 * with distinctive emails, ids, usernames and names, and the failures carry
 * a token, a URL and a host in their messages; none of it may reach the text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USERS = [
  {
    id: "cmownerabcdefghijklmnopq",
    username: "ownerperson",
    email: "owner.person@example.org",
    fullName: "Olive Owner",
    aiUsageLevel: null,
  },
  {
    id: "cmsecondabcdefghijklmnop",
    username: "secondperson",
    email: "second.person@mailbox.org",
    fullName: "Sam Second",
    aiUsageLevel: "FULL",
  },
];

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async () => USERS),
      groupBy: vi.fn(async () => [
        { aiProvider: "LOCAL", _count: { _all: 1 } },
        { aiProvider: null, _count: { _all: 1 } },
      ]),
    },
    appSettings: {
      findUnique: vi.fn(async () => ({
        glitchtipEnabled: true,
        glitchtipDsn: "https://key@glitchtip.example.net/1",
        webPushVapidPublicKey: null,
        webPushVapidPrivateKeyEncrypted: null,
        adminAiKeyEncrypted: "v1:ciphertext",
        adminCodexConnectionStatus: "disconnected",
        aiUsageDefaultLevel: "STANDARD",
        aiUsageMaxLevel: "FULL",
      })),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("server_version")) {
        return [
          { version: "16.4", timezone: "Etc/UTC", size: BigInt(52428800) },
        ];
      }
      if (sql.includes("migration_name")) {
        return [
          {
            migration_name: "0410_relation_links",
            finished_at: new Date("2026-10-15T08:00:00Z"),
          },
        ];
      }
      if (sql.includes("finished_at IS NULL")) return [{ count: 0 }];
      if (sql.includes("pgboss.job")) {
        return [{ at: new Date("2026-10-15T09:59:00Z") }];
      }
      return [];
    }),
    integrationWatch: {
      findMany: vi.fn(async () => [
        {
          userId: "cmsecondabcdefghijklmnop",
          integration: "nightscout",
          incidentReason: "unexpected_silence",
          incidentOpenedAt: new Date("2026-10-14T00:00:00Z"),
          alertedAt: null,
        },
      ]),
    },
    providerHealth: {
      findMany: vi.fn(async () => [
        {
          providerType: "LOCAL",
          lastResult: "hard_failed",
          lastStatus: 502,
          lastFailureAt: new Date("2026-10-15T07:00:00Z"),
          nextRetryAt: new Date(Date.now() + 60_000),
        },
      ]),
    },
    pushAttempt: {
      groupBy: vi.fn(async (args: { by: string[] }) =>
        args.by.includes("result")
          ? [
              { channel: "NTFY", result: "ok", _count: { _all: 9 } },
              { channel: "NTFY", result: "error", _count: { _all: 2 } },
            ]
          : [{ channel: "NTFY", reason: "http_500", _count: { _all: 2 } }],
      ),
    },
    dataBackup: {
      aggregate: vi.fn(async () => ({
        _max: { createdAt: new Date("2026-10-12T03:00:00Z") },
      })),
      count: vi.fn(async () => 2),
    },
    offhostBackupState: {
      findMany: vi.fn(async () => [
        { lastSuccessAt: new Date("2026-10-15T02:00:00Z") },
        { lastSuccessAt: null },
      ]),
    },
  },
}));

vi.mock("@/lib/api-handler", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-handler")>(
      "@/lib/api-handler",
    );
  return {
    ...actual,
    apiHandler: <T extends (...args: unknown[]) => Promise<Response>>(
      h: T,
    ): T => h,
    requireAdmin: vi.fn(),
  };
});

vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
  getEvent: vi.fn(() => null),
}));

vi.mock("@/lib/jobs/job-failures", () => ({
  JOB_FAILURE_WINDOW_HOURS: 72,
  readFailingQueues: vi.fn(async () => [
    {
      queue: "withings-sync",
      failures: 4,
      lastFailedAt: "2026-10-15T09:00:00.000Z",
      lastError:
        "TypeError: fetch https://wbsapi.withings.net/v2?access_token=abc failed for owner.person@example.org",
    },
  ]),
  readLastQueueRun: vi.fn(async (queue: string) =>
    queue === "data-restore-drill"
      ? {
          at: "2026-10-01T04:11:00.000Z",
          state: "failed",
          error: "connect ECONNREFUSED 10.0.0.12:9000 (s3.nas.lan)",
        }
      : null,
  ),
}));

vi.mock("@/lib/integrations/connection-health-load", () => ({
  loadConnectionHealth: vi.fn(async (userId: string) => {
    const empty = {
      withings: null,
      whoop: null,
      fitbit: null,
      "google-health": null,
      polar: null,
      oura: null,
      strava: null,
      nightscout: null,
      "apple-health": null,
    };
    if (userId === "cmownerabcdefghijklmnopq") {
      return {
        ...empty,
        withings: { state: "ok", reason: "data_arriving" },
      };
    }
    return {
      ...empty,
      withings: { state: "action_required", reason: "reauth_required" },
      nightscout: { state: "degraded", reason: "unexpected_silence" },
    };
  }),
}));

vi.mock("@/lib/geo", () => ({ offlineGeoReady: () => false }));

import { requireAdmin, HttpError } from "@/lib/api-handler";
import { appendLogEvent, clearLogBuffer } from "@/lib/logging/in-memory-buffer";
import { GET } from "../route";

const FORBIDDEN = [
  ...USERS.flatMap((u) => [u.id, u.username, u.email, u.fullName]),
  "wbsapi.withings.net",
  "access_token",
  "glitchtip.example.net",
  "10.0.0.12",
  "s3.nas.lan",
  "5d8e1b72-9a8c-49b7-801c-1dd42ba79dcc",
  "hlk_leaked_token",
];

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
  clearLogBuffer();
});

async function report(): Promise<{ generatedAt: string; text: string }> {
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

describe("GET /api/admin/support-report", () => {
  it("refuses a non-admin before reading anything", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new HttpError(403, "Forbidden"));
    await expect(GET()).rejects.toThrow("Forbidden");
  });

  it("answers the redacted report with every section", async () => {
    appendLogEvent({
      timestamp: "2026-10-15T09:40:00.000Z",
      duration_ms: 20,
      request_id: "5d8e1b72-9a8c-49b7-801c-1dd42ba79dcc",
      trace_id: "t",
      level: "error",
      kind: "http",
      service: "healthlog",
      environment: "test",
      action: { name: "measurement.batch.ingest" },
      auth: { user_id: "cmownerabcdefghijklmnopq" },
      error: {
        type: "TypeError",
        message: "Bearer hlk_leaked_token for owner.person@example.org",
      },
    });

    const { generatedAt, text } = await report();
    expect(Date.parse(generatedAt)).not.toBeNaN();
    for (const heading of [
      "## Build",
      "## Database",
      "## Configuration",
      "## Jobs",
      "## Connections",
      "## AI",
      "## Notifications (7 days)",
      "## Backups",
      "## Recent warnings and errors (this process)",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("- PostgreSQL: 16.4");
    expect(text).toContain("0410_relation_links");
    expect(text).toContain("- GlitchTip: yes");
    expect(text).toContain("withings-sync: 4 failed");
    expect(text).toContain("(TypeError)");
    expect(text).toContain(
      "- withings: action_required / reauth_required: 1 (Account 2)",
    );
    expect(text).toContain("- withings: ok / data_arriving: 1");
    expect(text).toContain("nightscout: unexpected_silence since");
    expect(text).toContain("Account 2");
    expect(text).toContain(
      "- Accounts by usage level: FULL 1, instance default 1",
    );
    expect(text).toContain(
      "LOCAL: ok 0, failing 1, credential refused 0, paused 1",
    );
    expect(text).toContain("- NTFY: ok 9, failed 2, skipped 0; http_500 2");
    expect(text).toContain(
      "Last restore drill: failed at 2026-10-01T04:11:00.000Z (ECONNREFUSED)",
    );
    expect(text).toContain("- error measurement.batch.ingest: 1x");

    for (const value of FORBIDDEN) {
      expect(text.toLowerCase(), value).not.toContain(value.toLowerCase());
    }
  });
});
