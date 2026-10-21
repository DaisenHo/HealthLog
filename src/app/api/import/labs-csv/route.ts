/**
 * `POST /api/import/labs-csv` — lab results from a spreadsheet (#1215).
 *
 * Body: the CSV file, streamed. Query: the column mapping and the file's
 * conventions (`labsCsvQuerySchema`). `dryRun=1` checks every row and reports
 * what would happen without writing; the real import writes in chunks, skips
 * readings the record already holds and reports every refused row by line.
 */
import { NextRequest } from "next/server";

import { apiHandler } from "@/lib/api-handler";
import { importLabsCsv } from "@/lib/import/labs-csv";
import { handleRecordImport } from "@/lib/import/record-import-route";
import { labsCsvQuerySchema } from "@/lib/validations/record-import";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async (request: NextRequest) =>
  handleRecordImport(request, {
    kind: "labs",
    module: "labs",
    schema: labsCsvQuerySchema,
    run: (args) => importLabsCsv(args),
  }),
);
