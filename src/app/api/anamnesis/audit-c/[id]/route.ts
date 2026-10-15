/**
 * `DELETE /api/anamnesis/audit-c/{id}` — remove an AUDIT-C entry (#614).
 * Soft delete; answers `{ id, removedAt }`, 404 `anamnesis.auditC.notFound`.
 *
 * Contract authority: `requireRecordAuth("manage", "profile")`. Until AUDIT-C
 * lands the stub resolves the caller's own record only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { notImplemented } from "@/lib/http/not-implemented";

type RouteParams = { params: Promise<{ id: string }> };

export const DELETE = apiHandler(
  async (_request: NextRequest, { params }: RouteParams) => {
    await requireAuth();
    await params;
    return notImplemented("anamnesis.audit_c.delete");
  },
);
