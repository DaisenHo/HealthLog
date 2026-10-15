/**
 * The integration watchdog's judgement, kept pure.
 *
 * Two questions per connection, answered from data the runner gathers:
 *
 *   1. Is a source that normally delivers unexpectedly silent?
 *      Only a CONTINUOUS source can be: a wearable, a CGM, a phone that
 *      records steps all day. Its own history decides "normally": it must have
 *      delivered on at least `NORMAL_DELIVERY_MIN_DAYS` of the previous
 *      `HISTORY_DAYS` days. An ON-DEMAND source (a scale, a blood-pressure
 *      cuff, a workout log) is silent whenever its owner does not measure,
 *      which says nothing about the pipe, so silence never counts for it; it
 *      is watched for errors only.
 *
 *   2. Is there an incident the operator should hear about?
 *      Unexpected silence; or a health state of `action_required` /
 *      `degraded` that has lasted longer than `INCIDENT_AFTER_MS`; or a
 *      failure streak the sync ledger already paged about (adopted, so the
 *      operator still gets the one recovery note when it ends).
 *
 * One incident per connection at a time. It is announced once and closed once;
 * a change of reason while it is open (silence turning into a reauth) is the
 * same incident and sends nothing.
 */
import type {
  ConnectionHealth,
  ConnectionHealthReason,
  ConnectionKey,
} from "./connection-health";

export type SourceCadenceKind = "continuous" | "on_demand";

export interface SourceProfile {
  kind: SourceCadenceKind;
  /** How long a continuous source may go without data before silence counts. */
  silenceWindowMs: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How many days of a connection's own history decide "normally delivers". */
export const HISTORY_DAYS = 14;

/** Days with data, out of `HISTORY_DAYS`, that make a source "normally delivering". */
export const NORMAL_DELIVERY_MIN_DAYS = 10;

/** How long a non-ok health state must last before it is an operator incident. */
export const INCIDENT_AFTER_MS = DAY_MS;

/**
 * Per connection. Withings is mostly scales and cuffs, Strava is workouts:
 * both are on-demand. Everything worn or attached around the clock is
 * continuous.
 *
 * Apple Health gets 48 h instead of 24 h. iOS defers background delivery when
 * the phone is low on storage, in low-power mode or simply not unlocked, and a
 * day of that is ordinary; the history gate already limits the check to
 * phones that deliver almost daily, and the longer window keeps an ordinary
 * quiet day from paging anyone.
 */
export const SOURCE_PROFILES: Record<ConnectionKey, SourceProfile> = {
  withings: { kind: "on_demand", silenceWindowMs: DAY_MS },
  strava: { kind: "on_demand", silenceWindowMs: DAY_MS },
  whoop: { kind: "continuous", silenceWindowMs: DAY_MS },
  oura: { kind: "continuous", silenceWindowMs: DAY_MS },
  fitbit: { kind: "continuous", silenceWindowMs: DAY_MS },
  "google-health": { kind: "continuous", silenceWindowMs: DAY_MS },
  polar: { kind: "continuous", silenceWindowMs: DAY_MS },
  nightscout: { kind: "continuous", silenceWindowMs: DAY_MS },
  "apple-health": { kind: "continuous", silenceWindowMs: 2 * DAY_MS },
};

/** Incident reason codes. The silence one is the watchdog's own. */
export type IncidentReason = ConnectionHealthReason;

export interface WatchRow {
  silentSince: Date | null;
  incidentReason: string | null;
  incidentOpenedAt: Date | null;
  alertedAt: Date | null;
}

export interface SilenceInput {
  profile: SourceProfile;
  /** Newest data instant, or null when the source never delivered. */
  lastDataAt: Date | null;
  /**
   * Distinct days with data in the `HISTORY_DAYS` before the silence window,
   * or null when the runner has not computed it (it only does when needed).
   */
  deliveredDays: number | null;
  /** The current flag, so an already-flagged source is not re-judged hourly. */
  currentSilentSince: Date | null;
  now: Date;
}

export type SilenceVerdict =
  /** Data is inside the window (or the source is on-demand): no flag. */
  | { kind: "clear" }
  /** Silent, and the history has to be read before deciding. */
  | { kind: "needs_history" }
  /** Silent, and the history says it should not be. */
  | { kind: "flag"; silentSince: Date }
  /** Silent, but it does not normally deliver: the owner is not using it. */
  | { kind: "not_expected" };

/**
 * Decide the silence flag. `deliveredDays` is only needed for a silent,
 * not-yet-flagged continuous source (the hourly pass reads it lazily) and for a
 * re-check of a flag (the daily pass passes it so a source its owner has
 * stopped using drops out once its history no longer says it delivers).
 */
export function classifySilence(input: SilenceInput): SilenceVerdict {
  const { profile, lastDataAt, now } = input;
  if (profile.kind === "on_demand") return { kind: "clear" };
  // A source that never delivered has no history to break with.
  if (lastDataAt === null) return { kind: "clear" };
  if (now.getTime() - lastDataAt.getTime() <= profile.silenceWindowMs) {
    return { kind: "clear" };
  }
  if (input.deliveredDays === null) {
    // Already flagged and nothing asked for a re-check: keep the flag as is.
    if (input.currentSilentSince) {
      return { kind: "flag", silentSince: input.currentSilentSince };
    }
    return { kind: "needs_history" };
  }
  if (input.deliveredDays >= NORMAL_DELIVERY_MIN_DAYS) {
    return {
      kind: "flag",
      silentSince: input.currentSilentSince ?? lastDataAt,
    };
  }
  return { kind: "not_expected" };
}

/**
 * The incident condition right now, or null when there is none.
 *
 * `health` is the resolved connection health WITHOUT the watchdog's own
 * silence flag folded in, so the silence condition and the state condition
 * stay separate. `ledgerAlerted` is true while the sync ledger holds an
 * unresolved page for the current streak.
 */
export function currentIncident(input: {
  health: ConnectionHealth | null;
  silentSince: Date | null;
  ledgerAlerted: boolean;
  now: Date;
}): { reason: IncidentReason; since: Date } | null {
  const { health, silentSince, now } = input;
  if (health === null) return null;
  const troubled =
    health.state === "action_required" || health.state === "degraded";
  if (troubled) {
    // A provider-side reauth flag (Google Health) can stand without a ledger
    // streak to date it; the last success is then when it last worked.
    const sinceIso = health.since ?? health.lastSuccessAt;
    const since = sinceIso ? new Date(sinceIso) : null;
    const lasted =
      since !== null && now.getTime() - since.getTime() > INCIDENT_AFTER_MS;
    if (lasted || input.ledgerAlerted) {
      return { reason: health.reason, since: since ?? now };
    }
  }
  if (silentSince) {
    return { reason: "unexpected_silence", since: silentSince };
  }
  return null;
}

export type WatchTransition =
  /** No incident before, none now. */
  | { kind: "none" }
  /** A new incident: announce it. */
  | { kind: "open"; reason: IncidentReason; since: Date }
  /** A new incident the ledger already announced: record it, send nothing. */
  | { kind: "adopt"; reason: IncidentReason; since: Date }
  /** Still open: send nothing. `announce` when the open incident was never announced (no channel last time). */
  | { kind: "keep"; reason: IncidentReason; announce: boolean }
  /** Over. `notify` when the operator had been told it started. */
  | { kind: "close"; notify: boolean; previousReason: string };

/**
 * Compare the open incident (if any) with the current condition. Pure; the
 * runner performs the side effects.
 */
export function decideWatchTransition(input: {
  row: WatchRow | null;
  incident: { reason: IncidentReason; since: Date } | null;
  ledgerAlerted: boolean;
}): WatchTransition {
  const open = input.row?.incidentReason ?? null;
  if (open === null) {
    if (input.incident === null) return { kind: "none" };
    return input.ledgerAlerted
      ? { kind: "adopt", ...input.incident }
      : { kind: "open", ...input.incident };
  }
  if (input.incident === null) {
    return {
      kind: "close",
      notify: input.row?.alertedAt != null,
      previousReason: open,
    };
  }
  return {
    kind: "keep",
    reason: input.incident.reason,
    announce: input.row?.alertedAt == null && !input.ledgerAlerted,
  };
}
