/**
 * One set of fast-check parameters for every property test.
 *
 * A pull request runs each property with a fixed seed, so the same inputs
 * are generated on every machine and a red run is a red run on the next
 * attempt too. The nightly workflow sets `FC_SEED` to a fresh value, which is
 * how new inputs get tried without making a pull request flaky; a failure
 * prints the seed and the shrunk counterexample, and
 * `FC_SEED=<seed> pnpm test <file>` replays it exactly.
 *
 * `FC_RUNS_FACTOR` multiplies every property's own case count (the nightly
 * run sets it above 1). A factor rather than a count: each property states
 * the number of cases its cost allows, a cheap law a few hundred and a
 * database round trip a dozen, and a nightly count applied to all of them
 * alike ran the round trip a hundred times against a timeout sized for
 * twelve. `propertyTimeout` grows a test's own timeout by the same factor.
 * The defaults keep every property file well under a second or two.
 */
import fc from "fast-check";

const DEFAULT_SEED = 20_261_022;

function positiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function positiveNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const PROPERTY_SEED = positiveInt(process.env.FC_SEED) ?? DEFAULT_SEED;

/** The multiplier on every property's case count; 1 on a pull request. */
export const RUNS_FACTOR = positiveNumber(process.env.FC_RUNS_FACTOR) ?? 1;

/**
 * Parameters for `fc.assert`; `numRuns` is the property's own case count on a
 * pull request, multiplied by `FC_RUNS_FACTOR` when it is set.
 */
export function propertyParameters<T>(
  numRuns = 100,
  overrides: fc.Parameters<T> = {},
): fc.Parameters<T> {
  return {
    seed: PROPERTY_SEED,
    numRuns: Math.max(1, Math.round(numRuns * RUNS_FACTOR)),
    ...overrides,
  };
}

/**
 * A test timeout for a property whose cases are expensive, grown by the same
 * factor as its case count, so a nightly run with more cases does not run
 * into a timeout sized for the pull-request count.
 */
export function propertyTimeout(baseMs: number): number {
  return Math.ceil(baseMs * Math.max(1, RUNS_FACTOR));
}

/** Run a property with the shared parameters. */
export function assertProperty<T>(
  property: fc.IProperty<T>,
  numRuns?: number,
): void {
  fc.assert(property, propertyParameters<T>(numRuns));
}

/** The async counterpart of {@link assertProperty}. */
export async function assertAsyncProperty<T>(
  property: fc.IAsyncProperty<T>,
  numRuns?: number,
): Promise<void> {
  await fc.assert(property, propertyParameters<T>(numRuns));
}

/**
 * IANA zones with the awkward cases in them: half- and quarter-hour offsets
 * (Kolkata, Kathmandu, Chatham, St John's), a 30-minute DST shift (Lord
 * Howe), southern-hemisphere DST (Santiago, Sydney, Auckland), a zone whose
 * DST starts at midnight (Santiago), the date line (Kiritimati, Apia), and a
 * zone with no DST at all (UTC, Kolkata).
 */
export const AWKWARD_ZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Dublin",
  "America/New_York",
  "America/Los_Angeles",
  "America/St_Johns",
  "America/Santiago",
  "America/Sao_Paulo",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Tehran",
  "Australia/Lord_Howe",
  "Australia/Sydney",
  "Australia/Adelaide",
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
  "Pacific/Apia",
  "Africa/Casablanca",
] as const;

export const zoneArb = fc.constantFrom(...AWKWARD_ZONES);

/** Instants between 1995 and 2040, at millisecond resolution. */
export const instantArb = fc.date({
  min: new Date("1995-01-01T00:00:00Z"),
  max: new Date("2040-12-31T23:59:59Z"),
  noInvalidDate: true,
});
