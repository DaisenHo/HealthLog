import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { auditLog } from "@/lib/auth/audit";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { markDisconnected } from "@/lib/integrations/status";

/**
 * v1.17.0 (F4) — disconnect Oura for the current user.
 *
 * Clears the stored access + refresh token on `User` and parks the integration
 * status at `disconnected`. Imported `source = OURA` measurements are left
 * intact; a reconnect resumes sync.
 */
export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "oura.disconnect" } });

  const rl = await checkRateLimit(`oura-disconnect:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return apiError("Too many requests", 429, {
      headers: rateLimitHeaders(rl),
    });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { ouraAccessTokenEncrypted: true },
  });
  if (!dbUser?.ouraAccessTokenEncrypted) {
    return apiError("No Oura connection", 404);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ouraAccessTokenEncrypted: null,
      ouraRefreshTokenEncrypted: null,
      ouraScopeDenied: Prisma.DbNull,
    },
  });

  await auditLog("oura.disconnect", { userId: user.id });
  await markDisconnected(user.id, "oura");

  return apiSuccess({ disconnected: true });
});
