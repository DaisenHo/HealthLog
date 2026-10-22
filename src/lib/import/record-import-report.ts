/**
 * The per-import report both record importers fill (#1215): counts, the row
 * errors in file order and a short preview, each bounded so a file of twenty
 * thousand broken rows answers with a report of a fixed size.
 */
import type {
  RecordImportResult,
  RecordImportRowReason,
} from "@/lib/validations/record-import";

export const MAX_REPORTED_ERRORS = 500;
export const MAX_PREVIEW_ROWS = 20;

export type PreviewRow = Record<string, string | number | boolean | null>;

export class RecordImportReport {
  rows = 0;
  valid = 0;
  inserted = 0;
  duplicates = 0;
  failed = 0;
  private errors: RecordImportResult["errors"] = [];
  private truncated = false;
  private preview: PreviewRow[] = [];

  constructor(
    readonly kind: RecordImportResult["kind"],
    readonly dryRun: boolean,
  ) {}

  private note(line: number, reason: RecordImportRowReason, field?: string) {
    if (this.errors.length < MAX_REPORTED_ERRORS) {
      this.errors.push(field ? { line, reason, field } : { line, reason });
    } else {
      this.truncated = true;
    }
  }

  fail(line: number, reason: RecordImportRowReason, field?: string) {
    this.failed += 1;
    this.note(line, reason, field);
  }

  duplicate(line: number) {
    this.duplicates += 1;
    this.note(line, "duplicate");
  }

  addPreview(row: PreviewRow) {
    if (this.dryRun && this.preview.length < MAX_PREVIEW_ROWS) {
      this.preview.push(row);
    }
  }

  toResult(
    extra: Pick<RecordImportResult, "markers"> = {},
  ): RecordImportResult {
    // Errors arrive per chunk; a chunk's duplicates are found after its
    // refusals, so put the list back in file order.
    const errors = [...this.errors].sort((a, b) => a.line - b.line);
    return {
      kind: this.kind,
      dryRun: this.dryRun,
      rows: this.rows,
      valid: this.valid,
      inserted: this.inserted,
      duplicates: this.duplicates,
      failed: this.failed,
      errors,
      errorsTruncated: this.truncated,
      ...extra,
      preview: this.preview,
    };
  }
}
