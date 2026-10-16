/**
 * v1.43 (#614) — which AUDIT-C entry is "the newest" for every reader.
 *
 * The answers are sealed; the sum is stored in the clear. An entry whose
 * answers this host can no longer open (a lost or retired key) still has a
 * readable sum, so a reader that skipped decryption used to take it as the
 * newest result while the read route, which needs the answers, showed an
 * older one beside it and offered the questionnaire again on a date neither
 * of them showed. One rule now holds everywhere a result is read (the read
 * route's `latest` and `offerDue`, the Coach block, the doctor report and
 * FHIR): the newest entry whose answers open. The history keeps listing every
 * entry by its sum, so an unreadable one can still be found and removed.
 */
import { decryptFromBytes } from "@/lib/ai/coach/bytes-codec";
import { prisma } from "@/lib/db";
import { getEvent } from "@/lib/logging/context";

/** How many entries back a reader looks for one it can open. */
export const AUDIT_C_HISTORY_LIMIT = 20;

/**
 * The sealed answers of one AUDIT-C entry. `schema` versions the blob the same
 * way the screener responses are versioned.
 */
export interface AuditCResponses {
  schema: 1;
  items: [number, number, number];
}

/** Open the sealed AUDIT-C answers; null when this host cannot read them. */
export function openAuditCResponses(
  payload: Uint8Array,
): AuditCResponses | null {
  try {
    const parsed = JSON.parse(
      decryptFromBytes(payload),
    ) as Partial<AuditCResponses>;
    const items = parsed.items;
    if (
      Array.isArray(items) &&
      items.length === 3 &&
      items.every((item) => Number.isInteger(item) && item >= 0 && item <= 4)
    ) {
      return { schema: 1, items: items as [number, number, number] };
    }
    getEvent()?.addWarning("audit-c responses shape drifted");
  } catch (error) {
    getEvent()?.addWarning(
      `audit-c responses decrypt failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return null;
}

/** The first entry of `rows` (newest first) whose answers open. */
export function newestReadableAuditC<
  T extends { responsesEncrypted: Uint8Array },
>(rows: readonly T[]): { row: T; items: [number, number, number] } | null {
  for (const row of rows) {
    const opened = openAuditCResponses(row.responsesEncrypted);
    if (opened) return { row, items: opened.items };
  }
  return null;
}

/** The newest readable entry of a record, for the readers that need one. */
export async function loadNewestReadableAuditC(userId: string): Promise<{
  id: string;
  takenAt: Date;
  totalScore: number;
  locale: string;
  tz: string | null;
} | null> {
  const rows = await prisma.mentalHealthAssessment.findMany({
    where: { userId, instrument: "AUDIT_C", deletedAt: null },
    orderBy: [{ takenAt: "desc" }, { id: "desc" }],
    take: AUDIT_C_HISTORY_LIMIT,
    select: {
      id: true,
      takenAt: true,
      totalScore: true,
      locale: true,
      tz: true,
      responsesEncrypted: true,
    },
  });
  const newest = newestReadableAuditC(rows);
  if (!newest) return null;
  const { responsesEncrypted: _sealed, ...entry } = newest.row;
  return entry;
}
