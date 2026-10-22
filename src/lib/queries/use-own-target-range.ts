"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/api-fetch";
import type { ThresholdMetric } from "@/lib/analytics/effective-range";
import type { TrafficRange } from "@/lib/analytics/value-bands";
import { useAuth } from "@/hooks/use-auth";
import { queryKeys } from "@/lib/query-keys";

/** The slice of `GET /api/user/thresholds` a chart band needs. */
interface ThresholdsSlice {
  effective: Partial<
    Record<string, { range: TrafficRange | null; isOverride: boolean }>
  >;
}

/**
 * The user's own target band for one metric, as the server resolved it, or
 * `null` when they have not set one (the chart then keeps its default band).
 *
 * `/api/user/thresholds` resolves every override through `getEffectiveRange`,
 * orange wings included, so the page draws the resolved range rather than
 * re-deriving one. Shares the `userThresholds()` cache entry with the target
 * editor, which invalidates it on save, so editing a target repaints the
 * chart without a reload.
 */
export function useOwnTargetRange(
  metric: ThresholdMetric,
): TrafficRange | null {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: queryKeys.userThresholds(),
    queryFn: () => apiGet<ThresholdsSlice>("/api/user/thresholds"),
    enabled: isAuthenticated,
  });
  return selectOwnTargetRange(data ?? null, metric);
}

/** Pure projection, exported for the unit test. */
export function selectOwnTargetRange(
  data: ThresholdsSlice | null,
  metric: ThresholdMetric,
): TrafficRange | null {
  const entry = data?.effective?.[metric];
  if (!entry?.isOverride) return null;
  return entry.range ?? null;
}
