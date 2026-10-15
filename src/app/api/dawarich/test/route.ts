/**
 * `POST /api/dawarich/test` — probe the connected Dawarich instance and answer
 * the shared integration probe shape. Part of the `environment` module; own
 * account only.
 */
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";

export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;
  return notImplemented("dawarich.test");
});
