/**
 * A `useUnitDisplay` result for the metric preference, for static renders
 * that have no QueryClient (the real hook hangs off `useAuth`). Metric is the
 * identity on values and yields the canonical display symbols.
 */
import * as dt from "@/lib/measurements/display-transform";
import type { UnitDisplay } from "@/hooks/use-unit-display";

export function metricUnitDisplay(
  glucoseUnit: UnitDisplay["glucoseUnit"] = "mg/dL",
): UnitDisplay {
  const forType = (t: string) => dt.getDisplayTransform(t, "metric");
  return {
    preference: "metric",
    glucoseUnit,
    transformFor: forType,
    toDisplay: (t, v) => dt.applyDisplayTransform(v, forType(t)),
    fromDisplay: (t, v) => dt.invertDisplayTransform(v, forType(t)),
    toDisplayDelta: (t, v) => dt.applyDisplayTransformDelta(v, forType(t)),
    unitFor: (t) => forType(t).displayUnit,
    decimalsFor: (t) => forType(t).decimals,
    isTransformed: (t) => dt.hasDisplayTransform(t),
  };
}
