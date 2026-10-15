/**
 * v1.29 — shared client-side DTOs for the `/insights/nutrients` cards.
 * Mirror the Zod response schemas in `src/lib/validations/nutrients.ts`
 * (`nutrientDailySeriesSchema` / `nutrientOverviewSchema`) — kept as
 * plain interfaces here so the client components stay decoupled from
 * the server-only Zod module graph.
 */

export interface ResolvedNutrientReferenceDto {
  kind: "PRI" | "AI" | "safeLevel";
  direction: "target" | "upperGuidance";
  value: number;
  source: string;
}

export interface NutrientDailySeries {
  nutrient: string;
  unit: string;
  windowDays: number;
  days: Array<{
    day: string;
    amount: number;
    bySource?: NutrientAmountBySource;
    aboveUpperLimit?: boolean | null;
  }>;
  reference: ResolvedNutrientReferenceDto | null;
  upperLimit?: NutrientUpperLimitDto | null;
}

/** v1.43 — an amount split by source; a source with nothing is absent. */
export type NutrientAmountBySource = Partial<
  Record<"APPLE_HEALTH" | "MANUAL" | "SUPPLEMENT", number>
>;

/** v1.43 — the tolerable upper intake level the server judged against. */
export interface NutrientUpperLimitDto {
  value: number;
  unit: string;
  scope: "total" | "supplemental";
  source: string;
}

export interface NutrientOverviewRow {
  nutrient: string;
  unit: string;
  latestDay: string;
  latestAmount: number;
  daysWithData: number;
  /** v1.43 — absent on an older server. */
  latestBySource?: NutrientAmountBySource;
  upperLimit?: NutrientUpperLimitDto | null;
  latestAboveUpperLimit?: boolean | null;
}

/**
 * Non-null only when `nutrients` is empty AND the most recent
 * `nutrient.batch.ingest` audit row shows a call that landed nothing —
 * `topReason` is the most common of the closed skip-reason codes
 * (`unit_mismatch` | `value_out_of_range` | `day_invalid` |
 * `upsert_failed`) from that call.
 */
export interface NutrientLastIngestAttempt {
  at: string;
  topReason: string;
}

export interface NutrientIntakeOverview {
  windowDays: number;
  nutrients: NutrientOverviewRow[];
  lastAttempt: NutrientLastIngestAttempt | null;
}
