/**
 * The answer to a delete that can take a period start with it (v1.43, ios
 * #116 item 9).
 *
 * Without a preference the delete answers 204, exactly as before, which is
 * what every client predating this relies on. With `Prefer:
 * return=representation` (RFC 7240) it answers 200 with the cycle it removed
 * and the starts that removal gave back — a start folded into the removed one
 * stands again — and says so in `Preference-Applied`.
 */
import { apiSuccess } from "@/lib/api-response";
import { hasPreference, RETURN_REPRESENTATION } from "@/lib/http/prefer";

export interface CycleRestoredStart {
  cycleId: string;
  startDate: string;
}

export function cycleDeleteOutcome(
  request: Request,
  removedCycleId: string | null,
  restored: readonly CycleRestoredStart[],
): Response {
  if (!hasPreference(request, RETURN_REPRESENTATION)) {
    return new Response(null, { status: 204 });
  }
  const response = apiSuccess({ removedCycleId, restored: [...restored] });
  response.headers.set("Preference-Applied", RETURN_REPRESENTATION);
  return response;
}
