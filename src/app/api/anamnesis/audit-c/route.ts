/**
 * `POST /api/anamnesis/audit-c` — record an AUDIT-C (#614).
 *
 * `{ items: [0..4, 0..4, 0..4], takenAt?, tz?, locale?, source, externalId? }`.
 * 201 `{ result: AuditCResult }` with the sum and the screening cut-off for
 * the entry's language and the profile's sex (null without one); a replay
 * with the same `externalId` answers 200 with the same result. Stored beside
 * the mental-health screeners but never listed by
 * `/api/mental-health/assessments`. At most 30 an hour, counted against the
 * person acting.
 *
 * Authority: `requireRecordAuth("manage", "profile")`, the level allergies and
 * family history are written at; the entry lands in the record and the trail
 * names the manager as actor.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import {
  apiError,
  apiSuccess,
  getClientIp,
  returnAllZodIssues,
  safeJson,
} from "@/lib/api-response";
import { auditLog } from "@/lib/auth/audit";
import { withIdempotency } from "@/lib/idempotency";
import { annotate } from "@/lib/logging/context";
import { createAuditC } from "@/lib/profile/life-circumstances";
import { checkRateLimit } from "@/lib/rate-limit";
import { auditCRequestSchema } from "@/lib/validations/life-circumstances";

export const POST = apiHandler(withIdempotency<[NextRequest]>(postAuditC));

async function postAuditC(request: NextRequest): Promise<Response> {
  const { user, actor } = await requireRecordAuth("manage", "profile");

  const rl = await checkRateLimit(`audit-c:${actor.id}`, 30, 60 * 60 * 1000);
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

  const input = parsed.data;
  const { result, replayed } = await createAuditC(user.id, {
    items: input.items,
    takenAt: input.takenAt ? new Date(input.takenAt) : undefined,
    tz: input.tz,
    locale: input.locale ?? user.locale ?? "en",
    source: input.source,
    externalId: input.externalId,
  });

  annotate({
    action: {
      name: replayed ? "anamnesis.audit_c.replay" : "anamnesis.audit_c.create",
      entity_type: "mental_health_assessment",
      entity_id: result.id,
    },
  });
  if (replayed) return apiSuccess({ result }, 200);

  // The id and the instrument only; the answers and the sum stay out of the trail.
  await auditLog("anamnesis.audit_c.create", {
    userId: user.id,
    ipAddress: getClientIp(request),
    details: { assessmentId: result.id, instrument: "AUDIT_C" },
  });
  return apiSuccess({ result }, 201);
}
