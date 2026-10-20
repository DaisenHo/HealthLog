import { z } from "zod/v4";
import { isoDateTime } from "@/lib/validations/datetime";

/**
 * v1.4.40 — AI consent receipts (App-Store Guideline 5.1.2(i) +
 * GDPR Art. 7 audit trail).
 *
 * The discriminator covers the consent surfaces collected independently:
 *   - `ai_full`           full assistant + on-device personalisation
 *   - `ai_insights_only`  read-only Insights generation (no Coach)
 *   - `ai_coach`          chat-style Coach access
 *   - `ai_extraction`     reading documents, lab report scans and typed
 *                         medication text with an external model (minted by
 *                         the document auto-read toggle; it satisfies neither
 *                         the Coach nor the analysis)
 *
 * Keeping each surface as its own row means the legal team can prove
 * which exact scope the user agreed to without parsing the signed
 * artefact server-side. The server stays opaque to the artefact's
 * format — we accept either a base64-encoded PDF or a signed JWT, the
 * audit trail *is* the storage plus the `signedAt` timestamp.
 */
export const consentKindEnum = z.enum([
  "ai_full",
  "ai_insights_only",
  "ai_coach",
  "ai_extraction",
]);

export type ConsentKind = z.infer<typeof consentKindEnum>;

/**
 * 64 KB upper bound on the artefact. A signed PDF receipt sits well
 * under 32 KB; a signed JWT is a few hundred bytes. The cap exists so
 * a misbehaving client (or a malicious one) can't fill the audit table
 * with multi-megabyte rows.
 *
 * v1.4.40 security M1 — the cap is enforced via `Buffer.byteLength(...,
 * "utf8")` because `z.string().max()` counts JavaScript string units
 * (UTF-16 code units), not bytes. A UTF-8 artefact full of multi-byte
 * code points (CJK, emoji) would otherwise be allowed past the 64 KB
 * row budget — the database stores bytes, not code units, and the
 * audit-table guarantee is byte-bounded.
 */
const ARTEFACT_MAX_BYTES = 64 * 1024;

/**
 * The explicit-confirmation flag every grant must carry. A receipt records a
 * person's own consent act, so the server mints one only for a request that
 * says it is that act: the tap on an "Agree" control sends `confirm: true`.
 * A request without it (an app that synced a receipt on launch, a page that
 * healed one on mount) is refused with {@link CONSENT_CONFIRM_REQUIRED_ERROR_CODE}
 * and mints nothing. Optional in the schema so the route can answer that
 * code rather than a generic validation error.
 */
const confirmFlag = z.boolean().optional();

/** The refusal code for a grant request without `confirm: true`. */
export const CONSENT_CONFIRM_REQUIRED_ERROR_CODE = "consent.ai.confirmRequired";

export const consentPostBody = z.object({
  kind: consentKindEnum,
  confirm: confirmFlag,
  artefact: z
    .string()
    .min(1, "artefact must not be empty")
    .refine((value) => Buffer.byteLength(value, "utf8") <= ARTEFACT_MAX_BYTES, {
      message: "artefact exceeds 64 KB cap (UTF-8 byte length)",
    }),
  signedAt: isoDateTime().transform((s) => new Date(s)),
});

export type ConsentPostBody = z.infer<typeof consentPostBody>;

/**
 * Body for `POST /api/consent/ai/web`: `{ "confirm": true }`, sent only by the
 * "Agree" control. There is no implicit form any more; a request without the
 * flag mints nothing.
 */
export const webConsentGrantBody = z.object({
  confirm: confirmFlag,
});

/**
 * Query schema for both `/api/consent/ai/latest` GET and DELETE.
 *
 * Omitting `kind` on GET returns the latest active receipt per kind
 * (a `Record<ConsentKind, …>` shape). Omitting it on DELETE revokes
 * the latest receipt across every kind — handy for the iOS
 * "deaktivieren alle KI-Funktionen" master toggle.
 */
export const consentLatestQuery = z.object({
  kind: consentKindEnum.optional(),
});

export type ConsentLatestQuery = z.infer<typeof consentLatestQuery>;
