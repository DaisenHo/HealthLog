/**
 * v1.21.3 (B1) — request schemas for the Coach goal / if-then plan surface
 * (`/api/coach/plans` + `/api/coach/plans/[id]`).
 *
 * Lives outside the route files so the OpenAPI registry can import it without
 * touching the route modules (route files may only export handlers + config)
 * and without dragging the Prisma-backed helper module into the generator
 * script.
 *
 * No `userId` field anywhere — the owner is always narrowed from the session.
 * The extractor is the only writer of plan TEXT; this surface only lets the
 * user CONFIRM (proposed → active), mark a plan met / abandoned, set a review
 * date, or soft-delete. It never accepts the encrypted free-text fields, so a
 * client can never inject or overwrite a plan's prose.
 */
import { z } from "zod/v4";

import { COACH_PLAN_STATUSES } from "@/lib/ai/coach/plans";
import { isoDateTime } from "@/lib/validations/datetime";

/**
 * Optional `?scope=` filter on the list endpoint — a named status group so
 * the plans management surface can pull its whole ledger in one read:
 *   - `open`: proposed + active + review_due (everything still standing)
 *   - `past`: met + abandoned + reviewed (the settled history)
 *   - `all`:  every non-deleted plan
 * Additive next to `?status=`; the two are mutually exclusive per request.
 */
export const COACH_PLAN_SCOPES = ["open", "past", "all"] as const;

/** Optional `?status=` / `?scope=` filters on the list endpoint. */
export const coachPlansListQuerySchema = z
  .object({
    status: z.enum(COACH_PLAN_STATUSES).optional(),
    scope: z.enum(COACH_PLAN_SCOPES).optional(),
  })
  .refine(
    (v) => !(v.status !== undefined && v.scope !== undefined),
    "Provide either status or scope, not both",
  );

/**
 * The user-facing PATCH body. `status` is the only mutable lifecycle field; a
 * `proposed` plan moves to `active` (confirm), or a plan moves to `met` /
 * `abandoned`. `reviewDate` optionally pins / clears a check-in checkpoint
 * (null clears). Strict: unknown keys 422, so a client cannot smuggle a
 * userId, a metric, or the encrypted text.
 */
export const coachPlanPatchSchema = z
  .object({
    status: z.enum(COACH_PLAN_STATUSES).optional(),
    reviewDate: isoDateTime().nullable().optional(),
  })
  .strict()
  .refine(
    (v) => v.status !== undefined || v.reviewDate !== undefined,
    "At least one of status or reviewDate must be provided",
  );
