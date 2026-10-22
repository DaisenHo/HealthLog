/**
 * v1.32.9 (Coach Guard II / G3) — the numeric doses on a user's active
 * medication schedule, for the Grounding Ledger and the plan-gated dose
 * continuation exemption.
 *
 * `Medication.dose` is free text as printed on the container ("7.5 mg",
 * "1 pieces", "0,25 mg"). It is deliberately NOT parsed into number + unit at
 * write time (see the schema note), so this helper extracts the leading numeric
 * magnitude the same way the display formatter does. The unit is irrelevant to
 * the match: the screen asks "is 7.5 the dose of the medication this sentence
 * names?", and the ledger asks only for the magnitudes.
 *
 * Server-only; a cheap indexed read over the user's active medications.
 */
import { prisma } from "@/lib/db";

/** Split on a leading number — mirrors `format-dose.ts` / `wizard-payload.ts`. */
const DOSE_EXPR_RE = /^\s*([+-]?\d+(?:[.,]\d+)?)/;

/** Parse the leading magnitude off a free-text dose, honouring a comma decimal. */
function parseDoseValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = DOSE_EXPR_RE.exec(raw.trim());
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** One active medication and the leading magnitude of its dose. */
export interface ScheduledDose {
  name: string;
  dose: number;
}

/**
 * The user's ACTIVE medications that carry a parseable dose, each with its
 * name. The outbound screen holds a "keep taking your N mg" to the dose of
 * the medication the sentence names, not to any dose on the schedule. Empty
 * when the user has no active medications or none carries a parseable dose.
 */
export async function getScheduledDosePlan(
  userId: string,
): Promise<ScheduledDose[]> {
  const rows = await prisma.medication.findMany({
    where: { userId, active: true },
    select: { name: true, dose: true },
  });
  const plan: ScheduledDose[] = [];
  for (const row of rows) {
    const dose = parseDoseValue(row.dose);
    if (dose !== null) plan.push({ name: row.name.trim(), dose });
  }
  return plan;
}
