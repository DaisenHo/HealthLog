/**
 * The request side the two CSV record imports share (#1215): owner-only auth,
 * the module gate, the rate buckets, the query parse, the content type and
 * the streamed body with its byte cap. Each route supplies its schema and its
 * importer; what a row becomes lives in `labs-csv.ts` / `medications-csv.ts`.
 *
 * Buckets: a dry run spends `import-preview:<id>` (30 an hour), because the
 * mapping screen re-checks the file whenever a column choice changes; the
 * real import spends the shared `import:<id>` bucket (5 an hour) every other
 * importer uses.
 */
import type { NextRequest } from "next/server";
import type { z } from "zod/v4";

import { requireAuth } from "@/lib/api-handler";
import {
  apiError,
  apiSuccess,
  getClientIp,
  returnAllZodIssues,
} from "@/lib/api-response";
import { auditLog } from "@/lib/auth/audit";
import { CsvTooLargeError } from "@/lib/import/csv-stream";
import { annotate } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";
import type { ModuleKey } from "@/lib/modules/registry";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveUserTimezone } from "@/lib/tz/resolver";
import type { RecordImportResult } from "@/lib/validations/record-import";

export const RECORD_IMPORT_MAX_BYTES = 16 * 1024 * 1024;
const PREVIEW_PER_HOUR = 30;
const IMPORT_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export async function handleRecordImport<
  S extends z.ZodType<{ dryRun: boolean }>,
>(
  request: NextRequest,
  opts: {
    kind: RecordImportResult["kind"];
    module: ModuleKey;
    schema: S;
    run: (args: {
      userId: string;
      tz: string;
      stream: ReadableStream<Uint8Array>;
      maxBytes: number;
      query: z.infer<S>;
    }) => Promise<RecordImportResult>;
  },
): Promise<Response> {
  const { user } = await requireAuth();
  const action = `import.${opts.kind}.csv`;
  annotate({ action: { name: action } });

  const gate = await requireModuleEnabled(user.id, opts.module);
  if (!gate.enabled) return gate.response;

  const parsed = opts.schema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return returnAllZodIssues(parsed.error, 422);
  const query = parsed.data;

  const rl = query.dryRun
    ? await checkRateLimit(
        `import-preview:${user.id}`,
        PREVIEW_PER_HOUR,
        HOUR_MS,
      )
    : await checkRateLimit(`import:${user.id}`, IMPORT_PER_HOUR, HOUR_MS);
  if (!rl.allowed) {
    return apiError(
      query.dryRun
        ? `Maximum ${PREVIEW_PER_HOUR} checks per hour`
        : `Maximum ${IMPORT_PER_HOUR} imports per hour`,
      429,
      { errorCode: "import.rate_limited" },
    );
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (
    !contentType.includes("text/csv") &&
    !contentType.includes("text/plain")
  ) {
    return apiError("Content-Type must be text/csv", 415, {
      errorCode: "import.csv.content_type",
    });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > RECORD_IMPORT_MAX_BYTES) {
    return apiError("CSV exceeds the 16 MB limit", 413, {
      errorCode: "import.csv.too_large",
    });
  }
  if (!request.body) {
    return apiError("The CSV file is empty", 422, {
      errorCode: "import.csv.empty",
    });
  }

  const tz = await resolveUserTimezone(user.id);
  let result: RecordImportResult;
  try {
    result = await opts.run({
      userId: user.id,
      tz,
      stream: request.body,
      maxBytes: RECORD_IMPORT_MAX_BYTES,
      query,
    });
  } catch (err) {
    if (err instanceof CsvTooLargeError) {
      return apiError("CSV exceeds the 16 MB limit", 413, {
        errorCode: "import.csv.too_large",
      });
    }
    throw err;
  }
  if (result.rows === 0) {
    return apiError("The CSV file has no data rows", 422, {
      errorCode: "import.csv.empty",
    });
  }

  if (!query.dryRun) {
    await auditLog(action, {
      userId: user.id,
      ipAddress: getClientIp(request),
      details: {
        rows: result.rows,
        inserted: result.inserted,
        duplicates: result.duplicates,
        failed: result.failed,
      },
    });
  }
  annotate({
    meta: {
      import_dry_run: query.dryRun,
      import_rows: result.rows,
      import_inserted: result.inserted,
      import_duplicates: result.duplicates,
      import_failed: result.failed,
    },
  });
  return apiSuccess(result);
}
