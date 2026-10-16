/**
 * `DawarichStatus`, resolved once for every reader (the status route and the
 * settings card through it).
 */
import { prisma } from "@/lib/db";
import { loadOneConnectionHealth } from "@/lib/integrations/connection-health-load";
import type { ConnectionHealth } from "@/lib/integrations/connection-health";

import { effectiveHomeCountry, openDawarichPrefs } from "./connection";

export interface DawarichStatus {
  connected: boolean;
  configured: boolean;
  homePlaceSet: boolean;
  homeCountry: string | null;
  daysStored: number;
  oldestDay: string | null;
  latestDay: string | null;
  health: ConnectionHealth | null;
}

export async function loadDawarichStatus(
  userId: string,
): Promise<DawarichStatus> {
  const [user, span, daysStored] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        dawarichUrlEncrypted: true,
        dawarichApiKeyEncrypted: true,
        dawarichPrefsEncrypted: true,
      },
    }),
    prisma.dawarichDay.aggregate({
      where: { userId },
      _min: { date: true },
      _max: { date: true },
    }),
    prisma.dawarichDay.count({ where: { userId } }),
  ]);
  const configured = !!user?.dawarichUrlEncrypted;
  const connected = configured && !!user?.dawarichApiKeyEncrypted;
  const prefs = openDawarichPrefs(user?.dawarichPrefsEncrypted);
  return {
    connected,
    configured,
    homePlaceSet: prefs.homePlaceId !== null,
    homeCountry: effectiveHomeCountry(prefs),
    daysStored,
    oldestDay: span._min.date ?? null,
    latestDay: span._max.date ?? null,
    health: connected
      ? await loadOneConnectionHealth(userId, "dawarich")
      : null,
  };
}
