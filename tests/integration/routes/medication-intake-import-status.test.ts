/**
 * `GET /api/medications/{id}/intake/import/{jobId}/status` — poll a
 * per-medication intake import, against the real database and through the
 * real API kit.
 *
 * Pinned here:
 *   - the caller's own job answers its state in every phase (queued,
 *     running, done, failed) with the projection the contract publishes,
 *     and nothing that names the record or the medication;
 *   - a stored result is passed through the allowlist: a well-formed one
 *     arrives, one that does not add up arrives as null;
 *   - another account's job, a job of another medication, an account-wide
 *     job and an unknown id are all the same 404;
 *   - an anonymous caller is 401.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { GET } from "@/app/api/medications/[id]/intake/import/[jobId]/status/route";

import { anonymous, callRoute } from "../../kit/call-route";
import { makeMedication, makeSession, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const ROUTE = "/api/medications/{id}/intake/import/{jobId}/status";

interface JobStatus {
  jobId: string;
  status: string;
  progress: unknown;
  result: unknown;
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

beforeEach(async () => {
  await truncateAllTables(prisma);
});

async function makeJob(
  recordUserId: string,
  medicationId: string | null,
  overrides: Partial<
    Omit<
      Prisma.MedicationIntakeImportJobUncheckedCreateInput,
      "recordUserId" | "medicationId"
    >
  > = {},
) {
  return prisma.medicationIntakeImportJob.create({
    data: {
      recordUserId,
      actorUserId: recordUserId,
      medicationId,
      payload: { rows: [] },
      progress: progress(0, 0),
      ...overrides,
    },
  });
}

/** The progress shape an admitted job carries, `processed` of `total` done. */
function progress(processed: number, total: number, imported = processed) {
  return {
    processed,
    total,
    imported,
    skippedByReason: {},
    touchedDays: [],
    rollupProcessed: 0,
  };
}

const PHASES: Array<
  [
    string,
    Partial<Prisma.MedicationIntakeImportJobUncheckedCreateInput>,
    Partial<JobStatus>,
  ]
> = [
  [
    "queued",
    { status: "queued", progress: progress(0, 2) },
    {
      progress: progress(0, 2),
      result: null,
      failureReason: null,
      startedAt: null,
      completedAt: null,
    },
  ],
  [
    "running",
    {
      status: "running",
      progress: progress(1, 2),
      startedAt: new Date("2026-07-21T10:00:01.000Z"),
    },
    {
      progress: progress(1, 2),
      startedAt: "2026-07-21T10:00:01.000Z",
      completedAt: null,
    },
  ],
  [
    "done",
    {
      status: "done",
      progress: progress(2, 2),
      result: { imported: 2, skipped: 0, skipReasons: [] },
      startedAt: new Date("2026-07-21T10:00:01.000Z"),
      completedAt: new Date("2026-07-21T10:00:02.000Z"),
    },
    {
      result: { imported: 2, skipped: 0, skipReasons: [] },
      failureReason: null,
      completedAt: "2026-07-21T10:00:02.000Z",
    },
  ],
  [
    "failed",
    {
      status: "failed",
      progress: progress(1, 2),
      failureReason: "Medication intake import failed",
      startedAt: new Date("2026-07-21T10:00:01.000Z"),
      completedAt: new Date("2026-07-21T10:00:02.000Z"),
    },
    {
      result: null,
      failureReason: "Medication intake import failed",
      completedAt: "2026-07-21T10:00:02.000Z",
    },
  ],
];

describe("GET /api/medications/{id}/intake/import/{jobId}/status", () => {
  it.each(PHASES)(
    "answers the owner's %s job without naming the record or the medication",
    async (status, stored, expected) => {
      const owner = await makeUser();
      const med = await makeMedication(owner);
      const job = await makeJob(owner.id, med.id, {
        ...stored,
        createdAt: new Date("2026-07-21T10:00:00.000Z"),
      });

      const res = await callRoute<JobStatus>(GET, {
        method: "GET",
        route: ROUTE,
        params: { id: med.id, jobId: job.id },
        auth: await makeSession(owner),
      });

      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({
        jobId: job.id,
        status,
        createdAt: "2026-07-21T10:00:00.000Z",
        ...expected,
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(owner.id);
      expect(text).not.toContain(med.id);
    },
  );

  it("answers a stored result that does not add up as null", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const job = await makeJob(owner.id, med.id, {
      status: "done",
      progress: progress(2, 2),
      // Two skips claimed, none accounted for.
      result: { imported: 2, skipped: 2, skipReasons: [], raw: "row data" },
    });

    const res = await callRoute<JobStatus>(GET, {
      method: "GET",
      route: ROUTE,
      params: { id: med.id, jobId: job.id },
      auth: await makeSession(owner),
    });

    expect(res.status).toBe(200);
    expect(res.data.result).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("row data");
  });

  it("answers the same 404 for a foreign job, another medication's job, an account-wide job and an unknown id", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const med = await makeMedication(owner);
    const sibling = await makeMedication(owner);
    const theirMed = await makeMedication(other);
    const theirs = await makeJob(other.id, theirMed.id);
    const siblings = await makeJob(owner.id, sibling.id);
    const accountWide = await makeJob(owner.id, null);
    const session = await makeSession(owner);

    const attempts: Array<{ id: string; jobId: string }> = [
      { id: theirMed.id, jobId: theirs.id },
      { id: med.id, jobId: theirs.id },
      { id: med.id, jobId: siblings.id },
      { id: med.id, jobId: accountWide.id },
      { id: med.id, jobId: "no-such-job" },
    ];
    const results = [];
    for (const params of attempts) {
      results.push(
        await callRoute(GET, {
          method: "GET",
          route: ROUTE,
          params,
          auth: session,
        }),
      );
    }

    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(new Set(results.map((r) => JSON.stringify(r.error))).size).toBe(1);
  });

  it("answers 401 to an anonymous caller", async () => {
    const owner = await makeUser();
    const med = await makeMedication(owner);
    const job = await makeJob(owner.id, med.id);

    const res = await callRoute(GET, {
      method: "GET",
      route: ROUTE,
      params: { id: med.id, jobId: job.id },
      auth: anonymous,
    });

    expect(res.status).toBe(401);
  });
});
