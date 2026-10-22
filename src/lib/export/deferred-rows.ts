/**
 * A bulk table the payload declares but has NOT read.
 *
 * `buildFullBackupPayload({ deferBulk: true })` puts one of these where the
 * row array would sit. The streaming writer recognises it, opens the JSON
 * array itself and pulls rows through page by page, so a table with half a
 * million rows never exists as an array at all. Every other caller leaves
 * `deferBulk` unset and gets the arrays, unchanged.
 *
 * The marker key is a symbol so it cannot collide with a payload field and so
 * the deferred payload can never be handed to `JSON.stringify` by accident and
 * come back looking merely empty — `streamFullBackupJson` is the only reader.
 */
const DEFERRED_ROWS = Symbol("healthlog.backup.deferredRows");

export interface DeferredRows {
  readonly [DEFERRED_ROWS]: true;
  /**
   * Open the row source. Called exactly once, by the streaming writer. A row
   * is a plain object, or a `StreamedField` (`streamed-field.ts`) for a row
   * with one field too large to hold as a string.
   */
  rows(): AsyncIterable<unknown>;
}

export function deferredRows(rows: () => AsyncIterable<unknown>): DeferredRows {
  return { [DEFERRED_ROWS]: true, rows };
}

/** True when a payload value is a deferred bulk table rather than an array. */
export function isDeferredRows(value: unknown): value is DeferredRows {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[DEFERRED_ROWS] === true
  );
}

/**
 * How many rows one page of a bulk table carries.
 *
 * Smaller than the measurement pager's 10 000 on purpose: an intake event
 * drags its medication's name along and a mood entry drags its links and its
 * day context, so a page of either costs several times what a page of
 * measurements costs. The number is a memory budget, not a throughput knob.
 */
export const BULK_PAGE_SIZE = 5_000;

/** Drain an async row source into an array. The materialising arm's only use. */
export async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of rows) out.push(row);
  return out;
}
