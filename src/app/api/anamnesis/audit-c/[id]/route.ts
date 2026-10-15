/**
 * `DELETE /api/anamnesis/audit-c/{id}` — remove an AUDIT-C entry (#614).
 * Soft delete (`deletedAt`); answers `{ id, removedAt }`, 404
 * `anamnesis.auditC.notFound` for an id that is not a live AUDIT-C entry of
 * the record. Authority `requireRecordAuth("manage", "profile")`, like the
 * create.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { apiError, apiSuccess, getClientIp } from "@/lib/api-response";
import { auditLog } from "@/lib/auth/audit";
import { annotate } from "@/lib/logging/context";
import { removeAuditC } from "@/lib/profile/life-circumstances";

type RouteParams = { params: Promise<{ id: string }> };

export const DELETE = apiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { user } = await requireRecordAuth("manage", "profile");
    const { id } = await params;

    const removed = await removeAuditC(user.id, id);
    if (!removed) {
      return apiError("AUDIT-C entry not found", 404, {
        errorCode: "anamnesis.auditC.notFound",
      });
    }

    await auditLog("anamnesis.audit_c.delete", {
      userId: user.id,
      ipAddress: getClientIp(request),
      details: { assessmentId: removed.id, instrument: "AUDIT_C" },
    });
    annotate({
      action: {
        name: "anamnesis.audit_c.delete",
        entity_type: "mental_health_assessment",
        entity_id: removed.id,
      },
    });
    return apiSuccess(removed);
  },
);
