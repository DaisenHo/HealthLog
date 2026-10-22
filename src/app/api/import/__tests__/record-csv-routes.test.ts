/**
 * The request side of `/api/import/labs-csv` and `/api/import/medications-csv`
 * (#1215): module gate first, a separate bucket for dry runs, the content
 * type, the byte cap while streaming, the mapping refused before anything is
 * read, and an audit row only for a real import.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requireModuleEnabled: vi.fn(),
  importLabsCsv: vi.fn(),
  importMedicationsCsv: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("@/lib/api-handler", () => ({
  apiHandler: (handler: unknown) => handler,
  requireAuth: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("@/lib/auth/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/modules/gate", () => ({
  requireModuleEnabled: mocks.requireModuleEnabled,
}));
vi.mock("@/lib/tz/resolver", () => ({
  resolveUserTimezone: vi.fn(async () => "Europe/Berlin"),
}));
vi.mock("@/lib/import/labs-csv", () => ({
  importLabsCsv: mocks.importLabsCsv,
}));
vi.mock("@/lib/import/medications-csv", () => ({
  importMedicationsCsv: mocks.importMedicationsCsv,
}));

import { CsvTooLargeError } from "@/lib/import/csv-stream";
import { POST as labsPost } from "../labs-csv/route";
import { POST as medsPost } from "../medications-csv/route";

type Handler = (req: NextRequest) => Promise<Response>;
const RESULT = {
  kind: "labs",
  dryRun: false,
  rows: 2,
  valid: 2,
  inserted: 2,
  duplicates: 0,
  failed: 0,
  errors: [],
  errorsTruncated: false,
  preview: [],
};

function post(
  handler: unknown,
  query: string,
  body = "a,b\n1,2\n",
  type = "text/csv",
) {
  return (handler as Handler)(
    new NextRequest(`http://localhost/api/import/x?${query}`, {
      method: "POST",
      headers: { "content-type": type },
      body,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.requireModuleEnabled.mockResolvedValue({ enabled: true });
  mocks.importLabsCsv.mockResolvedValue(RESULT);
  mocks.importMedicationsCsv.mockResolvedValue({
    ...RESULT,
    kind: "medications",
  });
});

const LABS = "analyte=0&value=1&unit=2&date=3";
const MEDS = "name=0&dose=1&times=2";

describe("record CSV import routes", () => {
  it("answers the module gate before reading the file", async () => {
    mocks.requireModuleEnabled.mockResolvedValue({
      enabled: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await post(labsPost, LABS)).status).toBe(403);
    expect(mocks.requireModuleEnabled).toHaveBeenCalledWith("user-1", "labs");
    expect(mocks.importLabsCsv).not.toHaveBeenCalled();
  });

  it("refuses a mapping without the required columns, or with a shared column", async () => {
    expect((await post(labsPost, "analyte=0&value=1")).status).toBe(422);
    expect((await post(labsPost, "analyte=0&value=0&date=1")).status).toBe(422);
    expect((await post(medsPost, "name=0")).status).toBe(422);
    expect(mocks.importLabsCsv).not.toHaveBeenCalled();
  });

  it("refuses an unknown parameter, so a misspelt dry run never writes", async () => {
    for (const typo of ["dryrun=1", "dry_run=1", "dryRun=1&preview=1"]) {
      expect((await post(labsPost, `${LABS}&${typo}`)).status).toBe(422);
      expect((await post(medsPost, `${MEDS}&${typo}`)).status).toBe(422);
    }
    expect(mocks.importLabsCsv).not.toHaveBeenCalled();
    expect(mocks.importMedicationsCsv).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("spends the preview bucket on a dry run and the import bucket otherwise", async () => {
    await post(labsPost, `${LABS}&dryRun=1`);
    expect(mocks.checkRateLimit).toHaveBeenLastCalledWith(
      "import-preview:user-1",
      30,
      3_600_000,
    );
    expect(mocks.auditLog).not.toHaveBeenCalled();
    await post(medsPost, MEDS);
    expect(mocks.checkRateLimit).toHaveBeenLastCalledWith(
      "import:user-1",
      5,
      3_600_000,
    );
    expect(mocks.auditLog).toHaveBeenCalledWith(
      "import.medications.csv",
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("answers 429 when the bucket is spent", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    expect((await post(labsPost, LABS)).status).toBe(429);
  });

  it("refuses a body that is not CSV", async () => {
    expect((await post(labsPost, LABS, "{}", "application/json")).status).toBe(
      415,
    );
  });

  it("turns the streaming cap into a 413", async () => {
    mocks.importLabsCsv.mockRejectedValue(new CsvTooLargeError(1));
    expect((await post(labsPost, LABS)).status).toBe(413);
  });

  it("calls a file without data rows empty", async () => {
    mocks.importLabsCsv.mockResolvedValue({ ...RESULT, rows: 0 });
    expect((await post(labsPost, LABS)).status).toBe(422);
  });

  it("hands the parsed mapping and the account zone to the importer", async () => {
    const res = await post(
      labsPost,
      `${LABS}&decimal=comma&dateOrder=dmy&delimiter=semicolon`,
    );
    expect(res.status).toBe(200);
    const args = mocks.importLabsCsv.mock.calls[0][0];
    expect(args.tz).toBe("Europe/Berlin");
    expect(args.query).toMatchObject({
      analyte: 0,
      value: 1,
      unit: 2,
      date: 3,
      decimal: "comma",
      dateOrder: "dmy",
      delimiter: "semicolon",
      dryRun: false,
      header: true,
    });
    expect(args.stream).toBeInstanceOf(ReadableStream);
  });
});
