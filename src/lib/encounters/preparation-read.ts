/**
 * The read behind `EncounterDTO.preparation`: one query of the record's past
 * visits for every booked visit on the page, resolved by the rule in
 * `preparation.ts`.
 */
import type { EncounterStatus, PrismaClient } from "@/generated/prisma/client";
import { userDayKey } from "@/lib/tz/format";
import { resolveUserTimezone } from "@/lib/tz/resolver";

import {
  resolvePreparation,
  type EncounterPreparationDTO,
  type PreparationVisit,
} from "./preparation";

/**
 * How many past visits the rule looks through, newest first. Far more than a
 * person files in years; a match older than the cap falls to the next rule,
 * which on an account this busy is never the default.
 */
export const PREPARATION_HISTORY_CAP = 500;

type Booked = PreparationVisit & { status: EncounterStatus };

/** The window before each booked visit in `upcoming`, by visit id. */
export async function loadVisitPreparations(
  db: Pick<PrismaClient, "encounter">,
  recordId: string,
  upcoming: readonly Booked[],
  now: Date,
): Promise<Map<string, EncounterPreparationDTO>> {
  const booked = upcoming.filter((visit) => visit.status === "PLANNED");
  if (booked.length === 0) return new Map();
  const [tz, done] = await Promise.all([
    resolveUserTimezone(recordId),
    db.encounter.findMany({
      where: {
        userId: recordId,
        deletedAt: null,
        status: "DONE",
        occurredAt: { lte: now },
      },
      select: {
        id: true,
        occurredAt: true,
        kind: true,
        practitionerId: true,
        practitioner: { select: { name: true, specialty: true } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: PREPARATION_HISTORY_CAP,
    }),
  ]);
  const today = userDayKey(now, tz);
  return new Map(
    booked.map((next) => [
      next.id,
      resolvePreparation({ next, done, tz, today }),
    ]),
  );
}
