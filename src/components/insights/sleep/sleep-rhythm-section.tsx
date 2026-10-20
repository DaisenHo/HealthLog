"use client";

import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";
import { useSleepRhythm } from "./use-sleep-rhythm";
import { SleepDebtCard } from "./sleep-debt-card";

/**
 * v1.17.0 — sleep-rhythm section on the Sleep page.
 *
 * Reads the server-authoritative sleep-debt + chronotype DTO and renders the
 * sleep-debt headline. Gated on `enabled` so a source-less account never
 * fetches. The values are identical to what the iOS client renders (one server
 * computation).
 *
 * v1.18.7 — the chronotype card moved out to `<ChronotypeSection>`, the
 * prominent bottom treatment of the Sleep view; this section now owns the
 * sleep-debt headline alone. Both read the same `["sleep-rhythm"]` cache.
 *
 * States, mirroring the glucose clinical panel's treatment:
 *   - loading  → skeleton (distinct from a settled-but-empty read)
 *   - error    → a quiet inline notice, never an endless skeleton
 *   - settled  → the debt card, which carries its OWN calm "still learning" /
 *                source-cue copy for the no-nights-yet case (the route always
 *                returns a full DTO, so emptiness surfaces inside the card).
 */
export function SleepRhythmSection({ enabled }: { enabled: boolean }) {
  const { isAuthenticated } = useAuth();
  const { data, isLoading, isError } = useSleepRhythm(
    isAuthenticated && enabled,
  );

  if (!enabled) return null;

  // The page owns the single error notice for this shared read (all three
  // cards resolve the same query, so a per-card notice printed it three
  // times). Bail out here rather than falling through to the skeleton below,
  // which would otherwise spin forever on a failed read.
  if (isError) return null;

  if (isLoading || !data) {
    return (
      <div className="space-y-4" data-slot="sleep-rhythm-loading">
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  return <SleepDebtCard debt={data.sleepDebt} />;
}
