import { AUTH_ERROR_CODES, REPROOF_REQUIRED_CODE } from "@/lib/api-errors";
import { DEFAULT_ERROR_CODES } from "@/lib/api/default-error-codes";

import { ApiError } from "./api-fetch";

/**
 * What a failed read means for the surface that made it.
 *
 *  - `unauthenticated`: 401. The session has ended. The surface says so and
 *    offers the way back to sign-in; drawing nothing would leave a page that
 *    looks empty for a reason the reader cannot see.
 *  - `refused`: 403. The viewer may not read this, typically a shared or
 *    delegated record whose grant leaves the section out. Nothing failed that
 *    a retry could fix, so the surface draws its refused state, or nothing.
 *  - `throttled`: 429. The read budget is spent for now; an immediate retry
 *    would only be refused again.
 *  - `failed`: everything else, a real read failure worth a retry.
 *
 * The code decides before the status. A 401 is not always an ended session:
 * a step-up or re-proof gate answers 401 too, with the session intact, and
 * sending that reader to sign-in would end a session that was fine. So a
 * code that names a missing proof reads as `failed`, a code that names an
 * ended credential reads as `unauthenticated` whatever the status, and only
 * a code this table does not know (or none, from a proxy or an older server)
 * falls back to the status.
 */
export type ReadFailureKind =
  "unauthenticated" | "refused" | "throttled" | "failed";

/** Codes that say the credential itself is gone: sign in again. */
const SESSION_ENDED_CODES: ReadonlySet<string> = new Set([
  AUTH_ERROR_CODES.missing,
  AUTH_ERROR_CODES.expired,
  AUTH_ERROR_CODES.invalid,
  DEFAULT_ERROR_CODES[401],
  "auth.refresh.invalid",
  "auth.refresh.reuse",
  "auth.refresh.revoked",
]);

/** Codes that ask for a fresh proof on a session that is still good. */
const PROOF_NEEDED_CODES: ReadonlySet<string> = new Set([
  "auth.stepup.required",
  REPROOF_REQUIRED_CODE,
  "auth.reproof.failed",
  "auth.reproof.too_weak",
  AUTH_ERROR_CODES.mfaCode,
]);

export function readFailureKind(error: unknown): ReadFailureKind {
  if (error instanceof ApiError) {
    const code = error.meta?.errorCode;
    if (typeof code === "string") {
      if (SESSION_ENDED_CODES.has(code)) return "unauthenticated";
      if (PROOF_NEEDED_CODES.has(code)) return "failed";
    }
    if (error.status === 401) return "unauthenticated";
    if (error.status === 403) return "refused";
    if (error.status === 429) return "throttled";
  }
  return "failed";
}

/** The sign-in page, returning to where the reader is now. */
export function signInHref(): string {
  if (typeof window === "undefined") return "/auth/login";
  const here = `${window.location.pathname}${window.location.search}`;
  return `/auth/login?next=${encodeURIComponent(here)}`;
}
