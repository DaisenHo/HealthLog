import { prisma } from "@/lib/db";
import { readOuraScopeDenied } from "@/lib/oura/credentials";
import {
  hasRecoveryData,
  resolveRecoveryEmpty,
  type RecoveryEmptyReason,
} from "./recovery-empty";

/**
 * The recovery page's empty reason for one account. Reads the Oura
 * connection only when no recovery type has a reading, so a page with data
 * never pays for it.
 */
export async function loadRecoveryEmpty(
  userId: string,
  summaries: Record<string, { count?: number } | null | undefined>,
): Promise<RecoveryEmptyReason | null> {
  if (hasRecoveryData(summaries)) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ouraAccessTokenEncrypted: true, ouraScopeDenied: true },
  });
  return resolveRecoveryEmpty(summaries, {
    connected: !!user?.ouraAccessTokenEncrypted,
    scopeDenied: readOuraScopeDenied(user?.ouraScopeDenied),
  });
}
