/**
 * `POST /api/anamnesis/audit-c` — record an AUDIT-C (#614).
 *
 * `{ items: [0..4, 0..4, 0..4], takenAt?, tz?, locale?, source, externalId? }`.
 * 201 `{ result: AuditCResult }` with the sum and the screening cut-off for
 * the entry's language and the profile's sex (null without one); a replay
 * with the same `externalId` answers 200 with the same result. Stored beside
 * the mental-health screeners but never listed by
 * `/api/mental-health/assessments`. At most 30 an hour.
 *
 * Contract authority: `requireRecordAuth("manage", "profile")`. Until AUDIT-C
 * lands the stub resolves the caller's own record only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError, returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { withIdempotency } from "@/lib/idempotency";
import { checkRateLimit } from "@/lib/rate-limit";
import { auditCRequestSchema } from "@/lib/validations/life-circumstances";

export const POST = apiHandler(withIdempotency<[NextRequest]>(postAuditC));

async function postAuditC(request: NextRequest): Promise<Response> {
  const { user } = await requireAuth();

  const rl = await checkRateLimit(`audit-c:${user.id}`, 30, 60 * 60 * 1000);
  if (!rl.allowed) {
    return apiError("Too many entries, try again later", 429, {
      errorCode: "anamnesis.auditC.rateLimited",
    });
  }

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 4 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = auditCRequestSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "anamnesis.auditC.invalid",
    });
  }

  return notImplemented("anamnesis.audit_c.create");
}
