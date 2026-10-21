/**
 * Which Oura OAuth scope each collection HealthLog reads sits behind. The one
 * source for the authorize request (`OURA_OAUTH_SCOPE`), the per-collection
 * missing-permission detection in the sync, the "reconnect once to grant the
 * new permissions" hint and the settings card.
 *
 * Oura's published material does not carry this map. The OpenAPI document
 * (https://cloud.ouraring.com/v2/static/json/openapi-1.42.json, the spec behind
 * https://cloud.ouraring.com/v2/docs) declares nine scopes and binds no
 * endpoint to any of them, and its list lacks `stress` altogether; the
 * authentication page (https://cloud.ouraring.com/docs/authentication) still
 * names `spo2Daily`, which the authorization server ignores. The map below is
 * what the live API enforces. It names the scope in its own refusal:
 *
 *   401 {"detail":"Token is not authorized access stress scope."}
 *
 * and integrations that read those refusals record the same assignments
 * (tidepool-org/platform `oura/oura.go`, `ScopesForDataType`). The developer
 * portal lists `stress`, `heart_health` and `spo2` among an app's permissions.
 * A dead token reads differently:
 *
 *   401 {"detail":"The access token provided is expired, revoked, malformed,
 *        or invalid for other reasons."}
 *
 * so the body, not the status, tells a missing permission from a dead token
 * (`parseOuraMissingScope`). A 403 is a lapsed Oura membership per the spec.
 *
 *   collection     endpoint (/v2/usercollection/…)   scope
 *   readiness      daily_readiness                   daily
 *   sleep          sleep                             daily
 *   activity       daily_activity                    daily
 *   daily_sleep    daily_sleep                       daily
 *   spo2           daily_spo2                        spo2
 *   vo2max         vO2_max                           heart_health
 *   cardio_age     daily_cardiovascular_age          heart_health
 *   resilience     daily_resilience                  stress
 *   workout        workout                           workout
 *   heartrate      heartrate                         heartrate
 *   (profile)      personal_info                     personal
 *   (cycle)        daily_cycle_phases                reproductive_cycle
 *
 * `reproductive_cycle` is not requested: the developer portal does not list it
 * for a self-registered app, and asking for a scope the app does not hold
 * would risk the whole authorization request. Cycle phases stay a best-effort read (`./cycle-sync`)
 * that never touches the connection's health, and no reconnect is suggested
 * for them because none would help.
 */

export const OURA_COLLECTIONS = [
  { name: "readiness", scope: "daily" },
  { name: "sleep", scope: "daily" },
  { name: "activity", scope: "daily" },
  { name: "daily_sleep", scope: "daily" },
  { name: "spo2", scope: "spo2" },
  { name: "vo2max", scope: "heart_health" },
  { name: "cardio_age", scope: "heart_health" },
  { name: "resilience", scope: "stress" },
  { name: "workout", scope: "workout" },
  { name: "heartrate", scope: "heartrate" },
] as const;

export type OuraCollectionName = (typeof OURA_COLLECTIONS)[number]["name"];

type OuraCollectionEntry = (typeof OURA_COLLECTIONS)[number];

/** The scope the profile probe (`personal_info`) needs. */
const OURA_PROFILE_SCOPE = "personal";

/**
 * Every scope HealthLog asks for, in a stable order: the scopes of the
 * collections it reads, plus the profile scope.
 */
const OURA_REQUESTED_SCOPES: readonly string[] = [
  ...new Set<string>([
    ...OURA_COLLECTIONS.map((c) => c.scope),
    OURA_PROFILE_SCOPE,
  ]),
];

/** The authorize request's `scope` parameter. */
export const OURA_OAUTH_SCOPE = OURA_REQUESTED_SCOPES.join(" ");

/**
 * Collections behind a scope beyond `daily`. A grant issued before HealthLog
 * requested that scope, or one where the person unticked it on the consent
 * screen, answers 401 on exactly these while the rest succeed, so they are the
 * only names the settings card is asked to explain. Each has a label under
 * `settings.integrations.oura.scope.items`. A collection behind `daily` is not
 * here: without `daily` nothing syncs, and that is a reconnect, not a hint.
 */
export type OuraScopeGatedCollection = Exclude<
  OuraCollectionEntry,
  { scope: "daily" }
>["name"];

export const OURA_SCOPE_GATED_COLLECTIONS = OURA_COLLECTIONS.filter(
  (c) => c.scope !== "daily",
).map((c) => c.name) as unknown as readonly [
  OuraScopeGatedCollection,
  ...OuraScopeGatedCollection[],
];

const GATED: ReadonlySet<string> = new Set(OURA_SCOPE_GATED_COLLECTIONS);

export function isOuraScopeGatedCollection(
  name: string,
): name is OuraScopeGatedCollection {
  return GATED.has(name);
}

/** Narrow a stored list to the known names, in display order. */
export function ouraScopeReconnectList(
  denied: readonly string[],
): OuraScopeGatedCollection[] {
  return OURA_SCOPE_GATED_COLLECTIONS.filter((c) => denied.includes(c));
}

/**
 * The scope a granted-scope string or a refusal names, without the `extapi:`
 * prefix Oura's authorization server puts on the scopes it grants (a request
 * for `daily` comes back as `extapi:daily`).
 */
function bareScope(s: string): string {
  return s.startsWith("extapi:") ? s.slice("extapi:".length) : s;
}

/**
 * The scopes a token response says were granted, or null when it carried no
 * `scope` (older apps; the field is optional). Space-separated per RFC 6749.
 */
export function parseOuraGrantedScopes(
  scope: string | null | undefined,
): Set<string> | null {
  if (typeof scope !== "string" || scope.trim() === "") return null;
  return new Set(scope.trim().split(/\s+/).map(bareScope));
}

/**
 * The gated collections a granted-scope string leaves out, in display order.
 * Null when the response named no scopes: then nothing is known until the
 * first sync reads the collections.
 */
export function ouraCollectionsMissingFromGrant(
  scope: string | null | undefined,
): OuraScopeGatedCollection[] | null {
  const granted = parseOuraGrantedScopes(scope);
  if (!granted) return null;
  return OURA_COLLECTIONS.filter(
    (
      c,
    ): c is Extract<OuraCollectionEntry, { name: OuraScopeGatedCollection }> =>
      c.scope !== "daily" && !granted.has(c.scope),
  ).map((c) => c.name);
}

const MISSING_SCOPE_DETAIL =
  /not authori[sz]ed (?:to )?access(?: the)? ([a-z0-9_:]{1,60}) scope/i;

/**
 * The scope a 401 body names when Oura refused the request for a missing
 * permission (`Token is not authorized access stress scope.`), or null for any
 * other body, a dead token's included.
 */
export function parseOuraMissingScope(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== "string") return null;
  const m = MISSING_SCOPE_DETAIL.exec(detail);
  return m ? bareScope(m[1]!.toLowerCase()) : null;
}
