/**
 * A backup row with one field too large to hold as a string.
 *
 * A stored document is up to a hundred megabytes, and its base64 in the backup
 * is a third larger. Built as a string, then serialised with the row, then
 * checked by the restore preview, one such field is several copies of itself
 * in a heap of 524 MB (#1239). A row of this kind carries the field as pieces
 * instead: the streaming writer (`full-backup-stream.ts`) writes the rest of
 * the row as `JSON.stringify` would, and the field's pieces in its place, so
 * the copy reads exactly as if the field had been a string.
 *
 * The pieces must not need JSON escaping (base64 does not), because they are
 * written between the quotes as they come.
 */
const STREAMED_FIELD = Symbol("healthlog.backup.streamedField");

export interface StreamedField {
  readonly [STREAMED_FIELD]: true;
  /** The row, with the streamed field present (its value is ignored). */
  readonly row: Record<string, unknown>;
  /** Which member of `row` is written from `pieces`. */
  readonly field: string;
  /**
   * What an observer of the writer is shown in the field's place: the start
   * of the value, or the whole value when it is short.
   */
  readonly observed: string;
  /** The field's value, in order. Opened once, by the writer. */
  readonly pieces: () => AsyncIterable<string>;
}

export function streamedField(
  row: object,
  field: string,
  observed: string,
  pieces: () => AsyncIterable<string>,
): StreamedField {
  return {
    [STREAMED_FIELD]: true,
    row: row as Record<string, unknown>,
    field,
    observed,
    pieces,
  };
}

export function isStreamedField(value: unknown): value is StreamedField {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[STREAMED_FIELD] === true
  );
}
