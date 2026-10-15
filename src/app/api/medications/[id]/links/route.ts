/**
 * `POST   /api/medications/{id}/links` — file conditions (the indication),
 * documents or visits against a medication.
 * `DELETE /api/medications/{id}/links` — unfile them.
 *
 * `{ targetKind, targetIds }` in, `{ changed, unknown }` out, through the
 * shared link service like the visit and vaccination link routes; an id that
 * names nothing this account owns comes back in `unknown`. Own account only,
 * as the other link routes.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { medicationLinkSchema } from "@/lib/validations/relation-links";

type RouteParams = { params: Promise<{ id: string }> };

async function handle(
  request: NextRequest,
  { params }: RouteParams,
  verb: "link" | "unlink",
): Promise<Response> {
  await requireAuth();
  await params;

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 16 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = medicationLinkSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "medication.link.invalid",
    });
  }

  return notImplemented(`medication.link.${verb}`);
}

export const POST = apiHandler(
  async (request: NextRequest, context: RouteParams) =>
    handle(request, context, "link"),
);

export const DELETE = apiHandler(
  async (request: NextRequest, context: RouteParams) =>
    handle(request, context, "unlink"),
);
