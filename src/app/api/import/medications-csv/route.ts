/**
 * `POST /api/import/medications-csv` — medications from a spreadsheet (#1215).
 *
 * Body: the CSV file, streamed. Query: the column mapping and the file's
 * conventions (`medicationsCsvQuerySchema`). Maps only name, dose, daily
 * times, as-needed and a start and end date; reminders stay off unless the
 * query turns them on. `dryRun=1` checks without writing.
 */
import { NextRequest } from "next/server";

import { apiHandler } from "@/lib/api-handler";
import { importMedicationsCsv } from "@/lib/import/medications-csv";
import { handleRecordImport } from "@/lib/import/record-import-route";
import { medicationsCsvQuerySchema } from "@/lib/validations/record-import";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async (request: NextRequest) =>
  handleRecordImport(request, {
    kind: "medications",
    module: "medications",
    schema: medicationsCsvQuerySchema,
    run: (args) => importMedicationsCsv(args),
  }),
);
