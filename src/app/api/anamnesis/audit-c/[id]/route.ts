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
import { prisma } from "@/lib/db";
import { annotate } from "@/lib/logging/context";
import { invalidateHealthProfileFactConsumers } from "@/lib/profile/health-facts";

type RouteParams = { params: Promise<{ id: string }> };

export const DELETE = apiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { user } = await requireRecordAuth("manage", "profile");
    const { id } = await params;

    // Soft delete, scoped to a live AUDIT-C entry of the record: a foreign
    // id, a screener's id or an entry already removed is the same 404.
    const now = new Date();
    const result = await prisma.mentalHealthAssessment.updateMany({
      where: { id, userId: user.id, instrument: "AUDIT_C", deletedAt: null },
      data: { deletedAt: now, syncVersion: { increment: 1 } },
    });
    if (result.count !== 1) {
      return apiError("AUDIT-C entry not found", 404, {
        errorCode: "anamnesis.auditC.notFound",
      });
    }
    await invalidateHealthProfileFactConsumers(user.id, prisma);
    const removed = { id, removedAt: now.toISOString() };

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
