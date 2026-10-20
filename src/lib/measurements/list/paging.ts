/**
 * A page cut in SQL that carries the size of the whole set.
 *
 * The page query selects `(COUNT(*) OVER ())::int AS total` beside its rows:
 * the window count runs before `LIMIT`, so every row of the page carries the
 * count of the whole filtered set and one round trip answers both. A page
 * past the end has no row to carry it; only then is the set counted on its
 * own, by `countAll`.
 */
export async function pageWithWindowTotal<T extends { total: number }>(
  rows: T[],
  offset: number,
  countAll: () => Promise<number>,
): Promise<{ rows: T[]; total: number }> {
  if (rows.length > 0) return { rows, total: Number(rows[0].total) };
  return { rows, total: offset > 0 ? await countAll() : 0 };
}
