/**
 * The key part that marks an analytics entry as a closed block: a value that
 * depends only on readings measured before `before`. Such a block is the
 * same however many syncs land after it, as long as none of them touches a
 * reading that old, so a measurement write that says how far back it
 * reached (`touchedFrom`) leaves it in place. Every other invalidation, and
 * every write that does not say, drops it as before.
 */
export function closedBlockKeyPart(before: Date | number): string {
  const ms = typeof before === "number" ? before : before.getTime();
  return `before:${ms}`;
}

const CLOSED_BLOCK_RE = /\|before:(\d+)(?:\||$)/;

/**
 * Whether `key` is a closed block that a write reaching back to
 * `touchedFrom` cannot have changed. Exported for its test.
 */
export function closedBlockUntouched(key: string, touchedFrom: Date): boolean {
  const match = CLOSED_BLOCK_RE.exec(key);
  return match !== null && Number(match[1]) <= touchedFrom.getTime();
}

/**
 * The earliest `measuredAt` among rows a write touched: the `touchedFrom` a
 * writer that knows every row it wrote hands to `invalidateUserMeasurements`.
 * `undefined` for no rows, which makes the invalidation drop closed blocks too.
 */
export function earliestMeasuredAt(
  rows: Iterable<{ measuredAt: Date }>,
): Date | undefined {
  let earliest: Date | undefined;
  for (const row of rows) {
    if (earliest === undefined || row.measuredAt < earliest) {
      earliest = row.measuredAt;
    }
  }
  return earliest;
}
