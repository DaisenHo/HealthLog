/**
 * The end of the legacy Fitbit Web API.
 *
 * Google turns it off on 30 October 2026: "On October 30, 2026, the Fitbit
 * Web API will be turned off and will no longer function or sync data to or
 * from Fitbit users" (https://developers.google.com/health/migration and the
 * August 2026 Google Health developer newsletter; support already ended on
 * 30 September 2026). Its successor is the Google Health API, which reads the
 * same Fitbit and Pixel devices. Access and refresh tokens cannot be carried
 * over, so a person moves by connecting Google Health and consenting once more.
 *
 * From the turndown on, HealthLog makes no Web API call for any Fitbit
 * connection: no poll, no backfill, no sleep repair, no token refresh, and no
 * new connection. The connection row and everything it imported stay. The
 * connection reads as not connected to the health read and the watchdog, so a
 * silence that is the provider's own shutdown pages nobody and asks nobody to
 * reconnect; the card keeps explaining the move instead.
 *
 * The cut is midnight UTC at the start of the published day, still the
 * evening before in the Americas. Stopping those few hours early costs
 * nothing Google Health does not bring back with its own history.
 */

/** The day Google turns the Web API off, as a calendar date. */
export const FITBIT_WEB_API_TURNDOWN_DATE = "2026-10-30";

// eslint-disable-next-line healthlog/no-utc-day-key -- UTC by design: one instant for every instance, the start of the published day (see the header)
const TURNDOWN_AT_MS = Date.parse(`${FITBIT_WEB_API_TURNDOWN_DATE}T00:00:00Z`);

/** True from the turndown on. */
export function isFitbitRetired(now: Date = new Date()): boolean {
  return now.getTime() >= TURNDOWN_AT_MS;
}

/** What the status envelope publishes on the Fitbit entry. */
export interface FitbitRetirement {
  /** The turndown day, `YYYY-MM-DD`. */
  endsOn: string;
  /** The day has come: the connection no longer syncs. */
  ended: boolean;
  /** The integration that reads the same devices. */
  successor: "google-health";
}

/**
 * The entry as published, with whether the card is offered at all: after the
 * turndown only to an account that had Fitbit (a connection, its own Fitbit
 * app, or imported Fitbit data). Decided by the status route.
 */
export interface PublishedFitbitRetirement extends FitbitRetirement {
  offered: boolean;
}

export function fitbitRetirement(now: Date = new Date()): FitbitRetirement {
  return {
    endsOn: FITBIT_WEB_API_TURNDOWN_DATE,
    ended: isFitbitRetired(now),
    successor: "google-health",
  };
}
