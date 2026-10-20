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
 */
export type ReadFailureKind =
  "unauthenticated" | "refused" | "throttled" | "failed";

export function readFailureKind(error: unknown): ReadFailureKind {
  if (error instanceof ApiError) {
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
