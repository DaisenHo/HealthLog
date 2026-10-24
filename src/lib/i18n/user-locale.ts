/**
 * The reader's locale for a server-internal caller that only has a user id.
 *
 * Route handlers use the stored preference, then the operator default for an
 * account without a choice, via `resolveServerLocale`. A few
 * server-internal fan-outs reach a prose-writing engine without a request of
 * their own — the Coach tool executor and the MCP rich reads both take a user
 * id and nothing else. This looks their stored preference up and hands it to
 * the SAME resolver, so there is one place that decides what language a
 * sentence is written in, not two.
 *
 * Deliberately its own module rather than a second export on `server-locale`:
 * this helper alone needs to look up a user row before resolving its language.
 */
import { prisma } from "@/lib/db";
import type { Locale } from "./config";
import { resolveServerLocale } from "./server-locale";

export async function resolveLocaleForUser(userId: string): Promise<Locale> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true },
  });
  return resolveServerLocale({ userLocale: row?.locale ?? null });
}
