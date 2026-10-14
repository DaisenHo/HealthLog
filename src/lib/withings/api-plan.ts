/**
 * Withings API plans (since 2026-10-12).
 *
 * Withings split its public API into plans. A self-hoster's own developer app
 * sits on the free "Start for Free" plan, which carries the core biomarkers
 * (activity, sleep, body, heart). The FDA/CE-cleared biomarkers and a handful
 * of body-composition extras need the paid "Advanced Biomarkers" plan. A
 * request that names anything outside the plan is refused WHOLE with status
 * 277 ("One of the data type requested in this API request is not available in
 * your API plan") — so one gated meastype in a `getmeas` call used to stop
 * weight and blood pressure from importing too.
 *
 * This module keeps the sync inside the plan:
 *
 *   - `requestWithinPlan` retries a refused request without the types Withings
 *     documents as advanced, then, if it is still refused, splits what is left
 *     in halves until every accepted subset has been read and every refused key
 *     is isolated. Bounded by `WITHINGS_PLAN_MAX_REQUESTS`; anything the budget
 *     could not resolve is unverified, never remembered as refused, and asked
 *     for again on the next run, which starts from what this one proved.
 *   - `WithingsApiPlanState` remembers per request family what the plan
 *     refused, so later runs skip those keys without paying a refused round
 *     trip, and re-probes them weekly in case the account's plan changes.
 *   - `releasePlanGatedWithingsParks` lifts connections an earlier build parked
 *     at `error_reauth` over a 277. Status 277 sits inside the 200..299 OAuth
 *     range the classifier used to read as a revoked grant; it is a contract
 *     limit, and reconnecting does not change it.
 *
 * Which keys are advanced comes from Withings' own biomarker table
 * (https://developer.withings.com/developer-guide/v3/data-api/all-available-health-data/,
 * the "Advanced Biomarkers" column) and the plans page
 * (https://static.withings.com/content/api/plans/plans.html).
 */
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { annotate, getEvent } from "@/lib/logging/context";
import { resumeIntegrationFromPark } from "@/lib/integrations/status";
import { WithingsApiError } from "./response-classifier";

/** The Withings body status for "not available in your API plan". */
export const WITHINGS_PLAN_GATED_STATUS = 277;

/** Upper bound on requests one plan probe may spend, the first one included. */
export const WITHINGS_PLAN_MAX_REQUESTS = 12;

/** How long a remembered refusal is trusted before the full set is re-probed. */
export const WITHINGS_PLAN_REPROBE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Meastypes HealthLog requests that Withings lists under the Advanced
 * Biomarkers plan: pulse-wave velocity (91), vascular age (155), visceral fat
 * (170), VO2 max (123) and skin temperature (73). Manual SpO2 (54), body
 * temperature (71), body composition and blood pressure are listed as free.
 * Types the table does not list at all (fat ratio 6, legacy temperature 12,
 * legacy SpO2 35) are left to the split, which finds out instead of guessing.
 */
export const WITHINGS_ADVANCED_MEASTYPES: readonly number[] = [
  91, 155, 170, 123, 73,
];

/**
 * The meastypes Withings lists as free in every plan and that carry the core
 * of the measure leg: weight (1), blood pressure (9, 10), pulse (11) and the
 * body-composition readings the table lists as free (fat-free mass 5, fat
 * mass 8, muscle mass 76, hydration 77, bone mass 88). A run that leaves one
 * of them out on the strength of plan memory has not read the window for it,
 * so the measure watermark must not move past it.
 */
export const WITHINGS_CORE_MEASTYPES: readonly number[] = [
  1, 5, 8, 9, 10, 11, 76, 77, 88,
];

/**
 * Sleep-summary fields HealthLog requests that the table marks advanced: the
 * sleep score, the overnight HRV and the respiration rate. The nightly average
 * heart rate is listed both ways (free for trackers, advanced for the Sleep
 * Analyzer) and the nightly SpO2 average is not listed, so both go to the split.
 */
export const WITHINGS_ADVANCED_SLEEP_FIELDS: readonly string[] = [
  "sleep_score",
  "sdnn_1",
  "rr_average",
];

// ── error recognition ──────────────────────────────────────────────────────

/**
 * True when a caught error is Withings' plan refusal. Reads the typed error
 * first and falls back to the message shape for errors that lost their
 * prototype on a job round trip.
 */
export function isPlanGatedError(err: unknown): boolean {
  if (err instanceof WithingsApiError) {
    return err.withingsStatus === WITHINGS_PLAN_GATED_STATUS;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return PLAN_GATED_MESSAGE.test(msg);
}

const PLAN_GATED_MESSAGE = /Withings\s+\w+\s+error:\s*277\b/;

// ── probing ────────────────────────────────────────────────────────────────

export interface WithinPlanResult<K, R> {
  /** Everything the accepted requests returned. */
  results: R[];
  /**
   * The requested keys the plan refused: isolated alone, or dropped as
   * documented advanced after the whole request was refused.
   */
  unavailable: K[];
  /**
   * The requested keys the budget ran out on. Neither read nor proven
   * refused: not to be remembered as unavailable, and to be asked for again.
   */
  unverified: K[];
  /** True when at least one request was refused with 277. */
  gated: boolean;
  /** True when at least one request was accepted. */
  acceptedAny: boolean;
  /** How many requests the call spent. */
  requests: number;
}

/**
 * Run `fetch` over `keys`, staying inside the account's API plan.
 *
 * The first request asks for every key. On a 277 the documented advanced keys
 * are dropped and the rest asked for again; on a further 277 the remainder is
 * split in halves, depth first and in input order, so the same refusal always
 * spends the same requests. A single key that is still refused is unavailable.
 * When the budget runs out, the subsets not yet resolved are unverified: the
 * caller remembers only what was proven, so the next run skips that and spends
 * its budget on the rest.
 *
 * Any error other than a 277 propagates unchanged: this only decides what the
 * plan allows, never whether the connection works.
 */
export async function requestWithinPlan<K, R>(opts: {
  keys: readonly K[];
  knownGated: readonly K[];
  fetch: (keys: K[]) => Promise<R[]>;
  maxRequests?: number;
}): Promise<WithinPlanResult<K, R>> {
  const budget = opts.maxRequests ?? WITHINGS_PLAN_MAX_REQUESTS;
  const keys = [...opts.keys];
  const results: R[] = [];
  const unavailable: K[] = [];
  const unverified: K[] = [];
  let requests = 0;
  let gated = false;
  let acceptedAny = false;

  // One request. `true` = accepted (results kept), `false` = refused by plan.
  const attempt = async (subset: K[]): Promise<boolean> => {
    requests++;
    try {
      results.push(...(await opts.fetch(subset)));
      acceptedAny = true;
      return true;
    } catch (err) {
      if (!isPlanGatedError(err)) throw err;
      gated = true;
      return false;
    }
  };

  if (keys.length === 0) {
    return { results, unavailable, unverified, gated, acceptedAny, requests };
  }
  if (await attempt(keys)) {
    return { results, unavailable, unverified, gated, acceptedAny, requests };
  }

  const knownGated = new Set(opts.knownGated);
  const dropped = keys.filter((k) => knownGated.has(k));
  let remaining = keys.filter((k) => !knownGated.has(k));
  if (dropped.length > 0) {
    unavailable.push(...dropped);
    if (remaining.length === 0) {
      return { results, unavailable, unverified, gated, acceptedAny, requests };
    }
    if (requests >= budget) {
      unverified.push(...remaining);
      return { results, unavailable, unverified, gated, acceptedAny, requests };
    }
    if (await attempt(remaining)) {
      return { results, unavailable, unverified, gated, acceptedAny, requests };
    }
  }

  // `remaining` is known to be refused as a whole. Split it until each accepted
  // part has been read and each refused key stands alone.
  if (remaining.length === 1) {
    unavailable.push(...remaining);
    return { results, unavailable, unverified, gated, acceptedAny, requests };
  }
  const stack: K[][] = halves(remaining).reverse();
  remaining = [];
  while (stack.length > 0) {
    const subset = stack.pop()!;
    if (requests >= budget) {
      unverified.push(...subset);
      continue;
    }
    if (await attempt(subset)) continue;
    if (subset.length === 1) {
      unavailable.push(subset[0]!);
      continue;
    }
    stack.push(...halves(subset).reverse());
  }

  return { results, unavailable, unverified, gated, acceptedAny, requests };
}

function halves<K>(list: K[]): K[][] {
  const mid = Math.ceil(list.length / 2);
  return [list.slice(0, mid), list.slice(mid)];
}

// ── remembered state ───────────────────────────────────────────────────────

/** The request families the plan can refuse independently. */
export type WithingsPlanLeg = "measures" | "sleepSummary" | "ecg";

export interface WithingsPlanLegState<K> {
  /** What the plan refused at the last probe. Empty = nothing refused. */
  unavailable: K[];
  /** When the full set was last asked for. */
  checkedAt: string;
}

export interface WithingsApiPlanState {
  version: 1;
  measures?: WithingsPlanLegState<number>;
  sleepSummary?: WithingsPlanLegState<string>;
  /** `unavailable` holds `"heart"` when the Heart endpoints are refused. */
  ecg?: WithingsPlanLegState<string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLeg<K>(
  value: unknown,
  isKey: (v: unknown) => v is K,
): WithingsPlanLegState<K> | undefined {
  if (!isObject(value)) return undefined;
  const { unavailable, checkedAt } = value;
  if (!Array.isArray(unavailable) || !unavailable.every(isKey))
    return undefined;
  if (typeof checkedAt !== "string" || !Number.isFinite(Date.parse(checkedAt)))
    return undefined;
  return { unavailable: [...new Set(unavailable)], checkedAt };
}

const isMeastype = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isFieldName = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9_]{1,64}$/.test(v);

/**
 * Persisted JSON is an untrusted boundary. A leg that does not validate is
 * dropped, which only means the next run asks for the full set again.
 */
export function parseWithingsApiPlanState(
  value: unknown,
): WithingsApiPlanState {
  const state: WithingsApiPlanState = { version: 1 };
  if (!isObject(value) || value.version !== 1) return state;
  const measures = parseLeg(value.measures, isMeastype);
  const sleepSummary = parseLeg(value.sleepSummary, isFieldName);
  const ecg = parseLeg(value.ecg, isFieldName);
  if (measures) state.measures = measures;
  if (sleepSummary) state.sleepSummary = sleepSummary;
  if (ecg) state.ecg = ecg;
  return state;
}

/** True when a remembered refusal is old enough to ask for the full set. */
export function isPlanReprobeDue(
  leg: WithingsPlanLegState<unknown> | undefined,
  now: Date = new Date(),
): boolean {
  if (!leg || leg.unavailable.length === 0) return false;
  return now.getTime() - Date.parse(leg.checkedAt) >= WITHINGS_PLAN_REPROBE_MS;
}

/** The keys a run should leave out: the remembered refusal, unless it is due. */
export function planSkipFor<K>(
  leg: WithingsPlanLegState<K> | undefined,
  now: Date = new Date(),
): K[] {
  if (!leg || isPlanReprobeDue(leg, now)) return [];
  return leg.unavailable;
}

/**
 * Write one leg of the plan state. A single statement merges the leg into the
 * stored object, so the measures, sleep and ECG legs (separate crons, separate
 * minutes) cannot overwrite each other's memory with a stale read.
 */
export async function persistWithingsPlanLeg(
  userId: string,
  leg: WithingsPlanLeg,
  state: WithingsPlanLegState<number> | WithingsPlanLegState<string>,
): Promise<void> {
  const value = JSON.stringify({
    unavailable: [...new Set<unknown>(state.unavailable)],
    checkedAt: state.checkedAt,
  });
  await prisma.$executeRaw`
    UPDATE "withings_connections"
    SET "api_plan_state" =
          COALESCE(
            CASE WHEN jsonb_typeof("api_plan_state") = 'object'
                  AND "api_plan_state"->'version' = '1'::jsonb
                 THEN "api_plan_state" END,
            '{}'::jsonb
          )
          || jsonb_build_object('version', 1)
          || jsonb_build_object(${leg}::text, ${value}::jsonb),
        "updated_at" = ${new Date()}
    WHERE "user_id" = ${userId}`;
  annotate({
    meta: {
      withings_plan: {
        leg,
        unavailable: state.unavailable.map(String),
      },
    },
  });
}

/**
 * Decide whether a run's outcome is worth writing down.
 *
 * A run that met a 277 is, but only when some other request in the same run
 * was accepted: a plan never refuses everything, so a run where every request
 * was refused (a transient fault upstream, a misconfigured developer app)
 * proves nothing about any single key, and remembering it would skip weight
 * and blood pressure for a week. A re-probe that met no 277 is written down
 * too, so a cleared refusal is forgotten. A run that skipped remembered keys
 * and was accepted changes nothing.
 */
export function shouldPersistPlanLeg(opts: {
  gated: boolean;
  reprobed: boolean;
  acceptedAny: boolean;
}): boolean {
  if (opts.gated) return opts.acceptedAny;
  return opts.reprobed;
}

// ── lifting parks an earlier build left ──────────────────────────────────────

/**
 * Lift every Withings connection parked over a plan refusal.
 *
 * Before 2026-10-14 the classifier read 277 as a revoked grant (it falls in the
 * 200..299 OAuth range), so the first refused `getmeas` parked the connection
 * at `error_reauth` and every leg stopped. Reconnecting cannot fix a plan
 * limit, so these rows are resumed instead: the next run reads inside the plan
 * and, because a refused run never advanced `lastSyncedAt`, imports everything
 * since the last good sync. The decision reads the stored error message, which
 * carries the Withings status the park was recorded with.
 *
 * Returns how many rows were lifted.
 */
export async function releasePlanGatedWithingsParks(): Promise<number> {
  const rows = await prisma.integrationStatus.findMany({
    where: {
      integration: "withings",
      state: "error_reauth",
    },
    select: { userId: true, lastError: true },
  });
  let released = 0;
  for (const row of rows) {
    if (!row.lastError || !parkedOverPlan(row.lastError)) continue;
    await resumeIntegrationFromPark(row.userId, "withings");
    released++;
  }
  if (released > 0) {
    annotate({ meta: { withings_plan_parks_released: released } });
  }
  return released;
}

function parkedOverPlan(lastErrorCiphertext: string): boolean {
  try {
    return PLAN_GATED_MESSAGE.test(decrypt(lastErrorCiphertext));
  } catch {
    getEvent()?.addWarning("withings plan release: undecryptable lastError");
    return false;
  }
}
