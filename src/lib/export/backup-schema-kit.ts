/**
 * The Zod primitives every backup schema slice shares: an ISO-8601 instant and
 * base64-encoded stored ciphertext.
 *
 * Loaded only through `src/lib/validations/backup.ts`, which builds the
 * payload schema on first use; see `backup-schema-lazy-guard.test.ts`.
 */
import { z } from "zod/v4";

export const isoDateTime = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "Expected ISO-8601 date-time string",
  });

export const base64BytesSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value),
    { message: "Expected base64-encoded encrypted bytes" },
  );
