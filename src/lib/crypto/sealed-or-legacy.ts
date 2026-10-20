/**
 * The one read rule for a value stored sealed beside a legacy readable column.
 *
 * Several columns moved from plaintext to AES-256-GCM and keep the readable
 * column until a backfill reaches every row: notes, workout tracks, the cached
 * insights payload. Each reader once picked its own order and its own answer
 * to a ciphertext that does not open, and they disagreed: two read the
 * ciphertext first, one read the readable column first, and of the two that
 * opened the ciphertext first one threw and one returned nothing.
 *
 * The order is fixed here and is not a parameter. A present ciphertext is
 * always the answer: the readable column is read only when the row has no
 * ciphertext, never as a stand-in for one that failed to open, because that
 * would serve whatever an older writer left in the clear in place of the value
 * the key was meant to protect. What a failure to open means is the caller's
 * decision and must be stated: `"throw"` for a record whose loss must surface,
 * or a handler for a value whose absence the surface can carry, typically
 * {@link warnAndDrop}.
 */
import { getEvent } from "@/lib/logging/context";

export type OnUndecryptable<T> = "throw" | ((error: unknown) => T | null);

export function readSealedOrLegacy<T>(args: {
  sealed: Uint8Array | null | undefined;
  legacy: T | null | undefined;
  open: (sealed: Uint8Array) => T;
  onUndecryptable: OnUndecryptable<T>;
}): T | null {
  const { sealed, legacy, open, onUndecryptable } = args;
  if (sealed && sealed.byteLength > 0) {
    if (onUndecryptable === "throw") return open(sealed);
    try {
      return open(sealed);
    } catch (error) {
      return onUndecryptable(error);
    }
  }
  return legacy ?? null;
}

/**
 * A handler that records the failure as a warning on the request's event and
 * reads the value as absent.
 */
export function warnAndDrop(label: string): (error: unknown) => null {
  return (error) => {
    getEvent()?.addWarning(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  };
}
