/**
 * The wire shape of a list cap, safe for the client bundle.
 *
 * A capped list answers with `meta: { truncated, limit }` on the envelope
 * (`apiListSuccess` in `./list-cap.ts`). That is the one place the signal
 * rides; `readListCap` is the one place a client reads it.
 */
export interface ListCap {
  /** A row past `limit` exists and was not returned. */
  truncated: boolean;
  /** The most rows this response could carry. */
  limit: number;
}

/** The cap an envelope's `meta` carries, or null when it carries none. */
export function readListCap(meta: unknown): ListCap | null {
  if (!meta || typeof meta !== "object") return null;
  const { truncated, limit } = meta as Record<string, unknown>;
  if (typeof truncated !== "boolean") return null;
  if (typeof limit !== "number" || !Number.isFinite(limit)) return null;
  return { truncated, limit };
}
