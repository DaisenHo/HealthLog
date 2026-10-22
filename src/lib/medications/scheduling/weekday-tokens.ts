/**
 * RFC 5545 BYDAY tokens in the order the weekday chip row renders them.
 *
 * Shared by the scheduling wizard and the server-side medication extraction
 * prompt, so it lives beside the recurrence engine rather than in a
 * component folder.
 */
export const WEEKDAY_TOKENS = [
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
] as const;
export type WeekdayToken = (typeof WEEKDAY_TOKENS)[number];
