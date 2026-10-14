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
 *     could not resolve counts as unavailable until the next probe.
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

/** The Withings plans page, linked from the settings card and the docs. */
export const WITHINGS_API_PLANS_URL =
  "https://static.withings.com/content/api/plans/plans.html";

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
  /** The requested keys the plan refused (or the budget could not clear). */
  unavailable: K[];
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
 * When the budget runs out, the subsets not yet tried count as unavailable for
 * now; the weekly re-probe asks for them again.
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
    return { results, unavailable, gated, acceptedAny, requests };
  }
  if (await attempt(keys)) {
    return { results, unavailable, gated, acceptedAny, requests };
  }

  const knownGated = new Set(opts.knownGated);
  const dropped = keys.filter((k) => knownGated.has(k));
  let remaining = keys.filter((k) => !knownGated.has(k));
  if (dropped.length > 0) {
    unavailable.push(...dropped);
    if (remaining.length === 0) {
      return { results, unavailable, gated, acceptedAny, requests };
    }
    if (requests >= budget) {
      unavailable.push(...remaining);
      return { results, unavailable, gated, acceptedAny, requests };
    }
    if (await attempt(remaining)) {
      return { results, unavailable, gated, acceptedAny, requests };
    }
  }

  // `remaining` is known to be refused as a whole. Split it until each accepted
  // part has been read and each refused key stands alone.
  if (remaining.length === 1) {
    unavailable.push(...remaining);
    return { results, unavailable, gated, acceptedAny, requests };
  }
  const stack: K[][] = halves(remaining).reverse();
  remaining = [];
  while (stack.length > 0) {
    const subset = stack.pop()!;
    if (requests >= budget) {
      unavailable.push(...subset);
      continue;
    }
    if (await attempt(subset)) continue;
    if (subset.length === 1) {
      unavailable.push(subset[0]!);
      continue;
    }
    stack.push(...halves(subset).reverse());
  }

  return { results, unavailable, gated, acceptedAny, requests };
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
        "updated_at" = NOW()
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
 * Decide whether a run's outcome is worth writing down. A run that met a 277
 * always is; so is a re-probe (the full set was asked for), whatever it found;
 * a run that skipped remembered keys and was accepted changes nothing.
 */
export function shouldPersistPlanLeg(opts: {
  gated: boolean;
  reprobed: boolean;
}): boolean {
  return opts.gated || opts.reprobed;
}

// ── what the settings card names ───────────────────────────────────────────

/**
 * The closed set of reading names the Withings card can show for a plan
 * refusal, in display order. Server-resolved so every client renders the same
 * list; each has a label under `settings.integrations.withings.plan.items`.
 */
export const WITHINGS_PLAN_FEATURES = [
  "spo2",
  "vascularAge",
  "pulseWaveVelocity",
  "vo2Max",
  "visceralFat",
  "skinTemperature",
  "ecg",
  "sleepScore",
  "sleepHrv",
  "sleepHeartRate",
  "sleepRespiratoryRate",
  "sleepSpo2",
  "bodyTemperature",
  "bodyFat",
  "fatMass",
  "fatFreeMass",
  "muscleMass",
  "bodyWater",
  "boneMass",
  "heartRate",
  "bloodPressure",
  "weight",
] as const;

export type WithingsPlanFeature = (typeof WITHINGS_PLAN_FEATURES)[number];

const MEASTYPE_FEATURE: Record<number, WithingsPlanFeature> = {
  1: "weight",
  5: "fatFreeMass",
  6: "bodyFat",
  8: "fatMass",
  9: "bloodPressure",
  10: "bloodPressure",
  11: "heartRate",
  12: "bodyTemperature",
  35: "spo2",
  54: "spo2",
  71: "bodyTemperature",
  73: "skinTemperature",
  76: "muscleMass",
  77: "bodyWater",
  88: "boneMass",
  91: "pulseWaveVelocity",
  123: "vo2Max",
  155: "vascularAge",
  170: "visceralFat",
};

const SLEEP_FIELD_FEATURE: Record<string, WithingsPlanFeature> = {
  hr_average: "sleepHeartRate",
  rr_average: "sleepRespiratoryRate",
  sdnn_1: "sleepHrv",
  spo2_average: "sleepSpo2",
  sleep_score: "sleepScore",
};

/**
 * The readings this connection's plan currently withholds, deduplicated and in
 * display order. Empty when nothing is refused.
 */
export function withingsPlanUnavailableFeatures(
  state: WithingsApiPlanState,
): WithingsPlanFeature[] {
  const found = new Set<WithingsPlanFeature>();
  for (const t of state.measures?.unavailable ?? []) {
    const f = MEASTYPE_FEATURE[t];
    if (f) found.add(f);
  }
  for (const field of state.sleepSummary?.unavailable ?? []) {
    const f = SLEEP_FIELD_FEATURE[field];
    if (f) found.add(f);
  }
  if ((state.ecg?.unavailable.length ?? 0) > 0) found.add("ecg");
  return WITHINGS_PLAN_FEATURES.filter((f) => found.has(f));
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
