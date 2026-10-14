/**
 * Link a marker to its analyte for the unit conversion.
 *
 * There is no manual choice of analyte: the key is a function of the marker's
 * name and unit (`matchAnalyteKey`). It is set when a marker is created and
 * re-derived whenever its name or unit changes, and this step brings a stored
 * key back in line with that function the first time a reading needs it. So a
 * marker that never had a key gets one, and a key that no longer agrees with
 * the name (written before a rename re-derived it, or in an older form) is
 * replaced, or cleared when the name now matches nothing. A key that agrees is
 * left alone, so the step is idempotent.
 *
 * The write is gated on the column still holding what the caller read, so two
 * concurrent writers converge, and a caller holding a stale copy re-reads the
 * row rather than writing over a newer value.
 */
import type { PrismaClient } from "@/generated/prisma/client";

import { matchAnalyteKey } from "./analyte-match";

interface MarkerKeyState {
  id: string;
  name: string;
  unit: string;
  analyteKey?: string | null;
}

export async function ensureAnalyteKey(
  client: Pick<PrismaClient, "biomarker">,
  marker: MarkerKeyState,
): Promise<string | null> {
  let current: MarkerKeyState = marker;
  // Two rounds: the caller's copy, then the row as it stands if that copy was
  // stale. A third writer racing both is vanishingly rare; the derived key is
  // still the right answer for the name this call saw.
  for (let round = 0; round < 2; round++) {
    const derived = matchAnalyteKey({ name: current.name, unit: current.unit });
    const stored = current.analyteKey ?? null;
    if (stored === derived) return derived;
    const { count } = await client.biomarker.updateMany({
      where: { id: current.id, analyteKey: stored },
      data: { analyteKey: derived },
    });
    if (count > 0) return derived;
    const row = await client.biomarker.findUnique({
      where: { id: current.id },
      select: { id: true, name: true, unit: true, analyteKey: true },
    });
    if (!row) return null;
    current = row;
  }
  return matchAnalyteKey({ name: current.name, unit: current.unit });
}
