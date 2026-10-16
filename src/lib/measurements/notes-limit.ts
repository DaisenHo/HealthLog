/**
 * v1.6.0 — notes cap raised from 25 to 200. A 25-char limit could not
 * hold a meaningful clinical note ("took after large meal, felt dizzy
 * standing up"). The DB column is unbounded `String?`; this is the
 * single source of truth the schemas and the client char-counters import.
 *
 * Its own module so the entry form can read the number without pulling the
 * measurement validation module, and Zod with it, into its route's first
 * load.
 */
export const MEASUREMENT_NOTES_MAX_LENGTH = 200;
