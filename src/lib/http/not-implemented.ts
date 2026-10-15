/**
 * The answer of a route whose contract is published but whose behaviour has
 * not landed on this server yet.
 *
 * A route answers this only after it has authenticated the caller, resolved
 * the record, applied its module gate and validated the request exactly as
 * the published contract says, so a client already sees the real refusals
 * (401, 403, 404, 422, 429). What is missing is the effect, and the body says
 * so plainly instead of pretending: `501` with `errorCode: "not_implemented"`.
 * Nothing calls these routes in normal use: every client path to them sits
 * behind a server feature flag that stays `false` until the route is filled.
 *
 * `contract-stub-inventory.test.ts` freezes the set of route files that still
 * answer this; it has to be empty before a release is tagged.
 */
import { apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";

export const NOT_IMPLEMENTED_ERROR_CODE = "not_implemented";

/**
 * 501 for an operation whose contract exists and whose effect does not yet.
 * `operation` is a stable `<surface>.<noun>.<verb>` name for the wide event.
 */
export function notImplemented(operation: string): Response {
  annotate({
    action: { name: "contract.not_implemented" },
    meta: { operation },
  });
  return apiError("Not implemented on this server yet", 501, {
    errorCode: NOT_IMPLEMENTED_ERROR_CODE,
    operation,
  });
}
