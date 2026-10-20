import { prisma } from "@/lib/db";
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { auditLog } from "@/lib/auth/audit";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { markDisconnected } from "@/lib/integrations/status";

/**
 * v1.17.0 — disconnect Polar for the current user.
 *
 * Clears the stored OAuth token + member id on `User` and parks the integration
 * status at `disconnected`. Imported `source = POLAR` measurements are left
 * intact (they are the user's historical readings); a reconnect resumes sync.
 */
export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "polar.disconnect" } });

  const rl = await checkRateLimit(`polar-disconnect:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return apiError("Too many requests", 429, {
      headers: rateLimitHeaders(rl),
    });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { polarAccessTokenEncrypted: true },
  });
  if (!dbUser?.polarAccessTokenEncrypted) {
    return apiError("No Polar connection", 404);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      polarAccessTokenEncrypted: null,
      polarUserIdEncrypted: null,
    },
  });

  await auditLog("polar.disconnect", { userId: user.id });
  await markDisconnected(user.id, "polar");

  return apiSuccess({ disconnected: true });
});
