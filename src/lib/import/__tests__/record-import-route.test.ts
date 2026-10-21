/**
 * The shared CSV record-import request side: the audit row is written for a
 * finished import and for one cut off part way, with how many rows landed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

const { auditLog } = vi.hoisted(() => ({ auditLog: vi.fn() }));

vi.mock("@/lib/api-handler", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: "u1" } })),
}));
vi.mock("@/lib/modules/gate", () => ({
  requireModuleEnabled: vi.fn(async () => ({ enabled: true })),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/lib/tz/resolver", () => ({
  resolveUserTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/auth/audit", () => ({ auditLog }));
vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));

import { handleRecordImport } from "../record-import-route";
import type { RecordImportResult } from "@/lib/validations/record-import";

const schema = z
  .object({ dryRun: z.enum(["0", "1"]).transform((v) => v === "1") })
  .strict();

function request(dryRun = "0") {
  return new Request(`http://localhost/api/import/labs-csv?dryRun=${dryRun}`, {
    method: "POST",
    headers: { "content-type": "text/csv" },
    body: "a,b\n1,2\n",
  }) as never;
}

const DONE = {
  kind: "labs",
  dryRun: false,
  rows: 400,
  valid: 400,
  inserted: 400,
  duplicates: 0,
  failed: 0,
} as unknown as RecordImportResult;

beforeEach(() => auditLog.mockReset());

describe("handleRecordImport audit", () => {
  it("audits a finished import as complete", async () => {
    await handleRecordImport(request(), {
      kind: "labs",
      module: "labs",
      schema,
      run: async ({ onWritten }) => {
        onWritten(200);
        onWritten(200);
        return DONE;
      },
    });
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][1].details).toMatchObject({
      inserted: 400,
      partial: false,
      written: 400,
    });
  });

  it("audits an import cut off part way with what it wrote", async () => {
    await expect(
      handleRecordImport(request(), {
        kind: "labs",
        module: "labs",
        schema,
        run: async ({ onWritten }) => {
          onWritten(200);
          throw new Error("client went away");
        },
      }),
    ).rejects.toThrow("client went away");
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][1].details).toEqual({
      partial: true,
      written: 200,
    });
  });

  it("writes no audit row for a dry run or an abort that wrote nothing", async () => {
    await handleRecordImport(request("1"), {
      kind: "labs",
      module: "labs",
      schema,
      run: async () => ({ ...DONE, dryRun: true }),
    });
    await expect(
      handleRecordImport(request(), {
        kind: "labs",
        module: "labs",
        schema,
        run: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(auditLog).not.toHaveBeenCalled();
  });
});
